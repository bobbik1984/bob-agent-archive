//! Narrow, read-only Bob Core client. Provider/DSH credentials never enter this adapter.
use super::{Capabilities, Catalog, ConnectionInfo, History, HistoryMessage, LiveView, RemoteAgent, RemoteSession, RemoteWorkspace};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{future::BoxFuture, StreamExt};
use rand::RngCore;
use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::atomic::{AtomicBool, Ordering}, time::{Duration, SystemTime, UNIX_EPOCH}};

const PROTOCOL: &str = "REMOTE_PROTOCOL";
const VERSION: &str = "bob-core-client/1.0";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

pub(super) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
fn id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 200 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') { return Err(PROTOCOL.into()); }
    Ok(())
}
fn secret(value: &str) -> Result<(), String> {
    if value.len() != 43 || URL_SAFE_NO_PAD.decode(value).map(|v| v.len()).ok() != Some(32) { return Err(PROTOCOL.into()); }
    Ok(())
}
pub(super) fn endpoint(input: &str) -> Result<Url, String> {
    if input.trim() != input || input.contains('\\') || input.chars().any(|c| c.is_control()) { return Err("REMOTE_INVALID_URL".into()); }
    let url = Url::parse(input).map_err(|_| "REMOTE_INVALID_URL")?;
    let host=url.host_str().unwrap_or("");
    let unsafe_host=host=="localhost" || host=="0.0.0.0" || host=="[::]" || host=="[::1]"
        || host.starts_with("127.") || host.starts_with('.') || host.ends_with('.') || host.contains("..");
    #[cfg(not(test))]
    if unsafe_host {return Err("REMOTE_INVALID_URL".into());}
    #[cfg(test)]
    if unsafe_host && !(url.scheme()=="http" && host=="127.0.0.1") {return Err("REMOTE_INVALID_URL".into());}
    let scheme_ok = url.scheme() == "https";
    // Plain HTTP is only accepted by the loopback test build, never in installed clients.
    #[cfg(test)] let scheme_ok = scheme_ok || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
    if !scheme_ok || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/" { return Err("REMOTE_INVALID_URL".into()); }
    Ok(url)
}
fn client() -> Result<Client, String> {
    Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(12))
        .build().map_err(|_| "REMOTE_NETWORK".into())
}
async fn request(client: &Client, base: &Url, method: Method, path: &str, token: Option<&str>, body: Option<Value>) -> Result<(StatusCode, Value), String> {
    let url = base.join(path).map_err(|_| PROTOCOL)?;
    if url.origin() != base.origin() || !url.path().starts_with("/api/client/v1/") { return Err("REMOTE_REDIRECT".into()); }
    let mut builder = client.request(method, url).header("Accept", "application/json");
    if let Some(token) = token { builder = builder.bearer_auth(token); }
    if let Some(body) = body { builder = builder.json(&body); }
    let response = builder.send().await.map_err(|e| if e.is_timeout() { "REMOTE_TIMEOUT" } else { "REMOTE_NETWORK" })?;
    let status = response.status();
    if status.is_redirection() { return Err("REMOTE_REDIRECT".into()); }
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "REMOTE_AUTH", 403 => "REMOTE_FORBIDDEN", 404 => "REMOTE_NOT_FOUND",
            409 => "REMOTE_STALE", 410 => "REMOTE_EXPIRED", 426 => "REMOTE_PROTOCOL",
            429 => "REMOTE_RATE_LIMIT", 501 => "REMOTE_UNSUPPORTED_CAPABILITY", 503 => "REMOTE_UNAVAILABLE", _ => PROTOCOL
        }.into());
    }
    if status == StatusCode::NO_CONTENT { return Ok((status, Value::Null)); }
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE as u64) { return Err("REMOTE_LIMIT".into()); }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "REMOTE_NETWORK")?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE { return Err("REMOTE_LIMIT".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map(|v| (status,v)).map_err(|_| PROTOCOL.into())
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub(super) struct Grant { pub project_id: String, pub scopes: Vec<String> }

// Serialize is used only inside the encrypted vault. Never return this through IPC.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct CoreCredential {
    pub access_token: String,
    pub credential_id: String,
    pub principal_id: String,
    pub server_instance_id: String,
    pub expires_at: u64,
    pub grants: Vec<Grant>,
}
impl CoreCredential {
    fn validate(&self) -> Result<(), String> {
        secret(&self.access_token)?;
        id(&self.credential_id)?; id(&self.principal_id)?; id(&self.server_instance_id)?;
        if self.expires_at <= now_ms() { return Err("REMOTE_EXPIRED".into()); }
        if self.expires_at > now_ms().saturating_add(24*60*60*1000+60_000) { return Err(PROTOCOL.into()); }
        if self.grants.is_empty() || self.grants.len() > 100 { return Err(PROTOCOL.into()); }
        let mut seen = HashSet::new();
        for grant in &self.grants {
            id(&grant.project_id)?;
            if !seen.insert(&grant.project_id) || grant.scopes.is_empty() || grant.scopes.len() > 6
                || !grant.scopes.iter().all(|s| ["work.read","work.submit","work.cancel","work.answer","work.approve_tool","work.review_accept"].contains(&s.as_str())) { return Err(PROTOCOL.into()); }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct CoreIdentity {
    pub server_instance_id: String,
    pub principal_id: String,
    pub credential_id: String,
    pub expires_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PairingInfo {
    pub pairing_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: u64,
    pub interval_ms: u64,
    pub challenge_fingerprint: String,
}
pub(super) struct Pairing {
    pub base: Url,
    pub name: String,
    verifier: String,
    client_instance_id: String,
    pairing_id: String,
    expires_at: u64,
    next_poll: u64,
    client: Client,
}
impl Pairing {
    pub(super) fn expired(&self) -> bool { self.expires_at <= now_ms() }
    pub(super) async fn begin(endpoint_value: &str, name: &str) -> Result<(Self, PairingInfo), String> {
        if name.trim().is_empty() || name.len() > 120 || name.chars().any(char::is_control) { return Err(PROTOCOL.into()); }
        let base = endpoint(endpoint_value)?;
        let client = client()?;
        let mut random = [0u8;32]; rand::thread_rng().fill_bytes(&mut random);
        let verifier = URL_SAFE_NO_PAD.encode(random); random.fill(0);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let client_instance_id = uuid::Uuid::new_v4().to_string();
        let (_, value) = request(&client,&base,Method::POST,"api/client/v1/pairings",None,Some(json!({
            "client_instance_id":client_instance_id,"client_name":name.trim(),"protocol_version":VERSION,
            "challenge_method":"S256","challenge":challenge
        }))).await?;
        let pairing_id = string(&value,"pairing_id")?.to_owned(); id(&pairing_id)?;
        let user_code = string(&value,"user_code")?.to_owned();
        if user_code.len() != 10 || !user_code.bytes().all(|c| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&c)) { return Err(PROTOCOL.into()); }
        let verification_uri = Url::parse(string(&value,"verification_uri")?).map_err(|_| PROTOCOL)?;
        if verification_uri.origin() != base.origin() || verification_uri.path() != "/client-connect" || verification_uri.fragment().is_some()
            || !verification_uri.username().is_empty() || verification_uri.password().is_some() { return Err("REMOTE_REDIRECT".into()); }
        let query: Vec<_> = verification_uri.query_pairs().collect();
        if query.len() > 1 || query.iter().any(|(k,v)| k != "user_code" || v != &user_code) { return Err(PROTOCOL.into()); }
        let expires_at = value["expires_at"].as_u64().ok_or(PROTOCOL)?;
        let interval_ms = value["interval_ms"].as_u64().ok_or(PROTOCOL)?;
        if expires_at <= now_ms() || expires_at > now_ms()+600_000+10_000 || !(5000..=60_000).contains(&interval_ms) { return Err(PROTOCOL.into()); }
        let fingerprint=format!("{:x}",Sha256::digest(challenge.as_bytes()));
        let info = PairingInfo { pairing_id:pairing_id.clone(),user_code,verification_uri:verification_uri.to_string(),expires_at,interval_ms,challenge_fingerprint:fingerprint[..12].into() };
        Ok((Self{base,name:name.trim().into(),verifier,client_instance_id,pairing_id,expires_at,next_poll:now_ms()+interval_ms,client},info))
    }
    pub(super) async fn poll(&mut self) -> Result<Option<CoreCredential>, String> {
        if self.expired() { return Err("REMOTE_EXPIRED".into()); }
        if now_ms() < self.next_poll { return Ok(None); }
        self.next_poll = now_ms()+5000;
        // A failed exchange may already have consumed authorization. Caller removes
        // the pairing on any error: there is no token-response replay or blind retry.
        let (status,value) = request(&self.client,&self.base,Method::POST,&format!("api/client/v1/pairings/{}/exchange",self.pairing_id),None,
            Some(json!({"verifier":self.verifier,"client_instance_id":self.client_instance_id}))).await.map_err(|e| {
                if ["REMOTE_NETWORK","REMOTE_TIMEOUT","REMOTE_LIMIT","REMOTE_PROTOCOL","REMOTE_REDIRECT","REMOTE_UNAVAILABLE"].contains(&e.as_str()) {
                    "REMOTE_PAIRING_REVOKE_REQUIRED".into()
                } else {e}
            })?;
        if status == StatusCode::ACCEPTED {
            if value["status"] != "pending" { return Err(PROTOCOL.into()); }
            let interval = value["interval_ms"].as_u64().ok_or(PROTOCOL)?;
            if !(5000..=60_000).contains(&interval) { return Err(PROTOCOL.into()); }
            self.next_poll = now_ms()+interval;
            return Ok(None);
        }
        if value["token_type"] != "Bearer" { return Err("REMOTE_PAIRING_REVOKE_REQUIRED".into()); }
        let credential: CoreCredential = serde_json::from_value(value).map_err(|_| "REMOTE_PAIRING_REVOKE_REQUIRED")?;
        credential.validate().map_err(|_|"REMOTE_PAIRING_REVOKE_REQUIRED")?;
        Ok(Some(credential))
    }
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str,String> { value[key].as_str().filter(|s| !s.is_empty()).ok_or_else(|| PROTOCOL.into()) }

pub(super) struct Core {
    base: Url,
    client: Client,
    credential: CoreCredential,
    info: ConnectionInfo,
    alive: AtomicBool,
}
impl Core {
    pub(super) async fn connect(endpoint_value:&str,credential:CoreCredential,profile_id:Option<String>) -> Result<Self,String> {
        credential.validate()?;
        let base=endpoint(endpoint_value)?; let client=client()?;
        let (_,value)=request(&client,&base,Method::GET,"api/client/v1/capabilities",Some(&credential.access_token),None).await?;
        if value["protocol_version"] != VERSION || value["server_instance_id"] != credential.server_instance_id
            || value["principal_id"] != credential.principal_id || value["credential_id"] != credential.credential_id
            || value["expires_at"].as_u64()!=Some(credential.expires_at) { return Err("REMOTE_IDENTITY_CHANGED".into()); }
        let grants:Vec<Grant>=serde_json::from_value(value["grants"].clone()).map_err(|_|PROTOCOL)?;
        // Replacing metadata on refresh is never an implicit authorization upgrade.
        if grants.iter().any(|g| !credential.grants.iter().any(|old| old.project_id==g.project_id && g.scopes.iter().all(|s|old.scopes.contains(s)))) { return Err("REMOTE_IDENTITY_CHANGED".into()); }
        if value["capabilities"]["catalog"] != true || value["capabilities"]["history"] != true { return Err("REMOTE_UNSUPPORTED_CAPABILITY".into()); }
        let mut credential=credential; credential.grants=grants;
        let info=ConnectionInfo{connection_id:uuid::Uuid::new_v4().to_string(),profile_id,adapter:"bob-core".into(),endpoint:base.origin().ascii_serialization(),
            capabilities:Capabilities{catalog:true,history:true,send:false,approvals:false,artifacts:false},
            core:Some(CoreIdentity{server_instance_id:credential.server_instance_id.clone(),principal_id:credential.principal_id.clone(),credential_id:credential.credential_id.clone(),expires_at:credential.expires_at})};
        Ok(Self{base,client,credential,info,alive:AtomicBool::new(true)})
    }
    fn check(&self) -> Result<(),String> {
        if !self.alive.load(Ordering::SeqCst) {return Err("REMOTE_DISCONNECTED".into());}
        if self.credential.expires_at<=now_ms() {return Err("REMOTE_EXPIRED".into());}
        Ok(())
    }
    fn project(&self,project_id:&str)->Result<(),String> {
        self.check()?; id(project_id)?;
        if !self.credential.grants.iter().any(|g|g.project_id==project_id && g.scopes.iter().any(|s|s=="work.read")) {return Err("REMOTE_FORBIDDEN".into());}
        Ok(())
    }
    async fn get(&self,path:&str)->Result<Value,String> {
        self.check()?;
        let result=request(&self.client,&self.base,Method::GET,path,Some(&self.credential.access_token),None).await;
        if let Err(e)=&result {if ["REMOTE_AUTH","REMOTE_EXPIRED"].contains(&e.as_str()) {self.close();} return Err(e.clone());}
        self.check()?;
        result.map(|(_,v)|v)
    }
    pub(super) async fn revoke(endpoint_value:&str,credential:&CoreCredential)->Result<(),String> {
        let base=endpoint(endpoint_value)?;
        request(&client()?,&base,Method::POST,"api/client/v1/credentials/self/revoke",Some(&credential.access_token),Some(json!({}))).await?;
        Ok(())
    }
    async fn messages(&self,project_id:&str,after:u64)->Result<CoreMessagePage,String> {
        self.project(project_id)?;
        if after>9_007_199_254_740_991 {return Err(PROTOCOL.into());}
        let value=self.get(&format!("api/client/v1/projects/{project_id}/messages?after={after}")).await?;
        let items=value["items"].as_array().ok_or(PROTOCOL)?;
        if items.len()>100 {return Err("REMOTE_LIMIT".into());}
        let mut messages=Vec::new(); let mut last=after; let mut seen=HashSet::new();
        for item in items {
            let sequence=item["sequence"].as_u64().ok_or(PROTOCOL)?;
            let message_id=string(item,"id")?;
            let role=string(item,"role")?;
            let content=item["content"].as_str().ok_or(PROTOCOL)?;
            if item["project_id"]!=project_id || sequence<=last || sequence>9_007_199_254_740_991 || !seen.insert(message_id) || !["user","assistant"].contains(&role) || content.len()>256*1024 {return Err(PROTOCOL.into());}
            last=sequence;
            messages.push(HistoryMessage{id:message_id.into(),role:role.into(),text:content.into(),..Default::default()});
        }
        let next_after=value["next_after"].as_u64().ok_or(PROTOCOL)?;
        let has_more=value["has_more"].as_bool().ok_or(PROTOCOL)?;
        if next_after!=last || (has_more && items.is_empty()) {return Err(PROTOCOL.into());}
        Ok(CoreMessagePage{session_id:project_id.into(),messages,next_after,has_more})
    }
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CoreMessagePage {pub session_id:String,pub messages:Vec<HistoryMessage>,pub next_after:u64,pub has_more:bool}

impl RemoteAgent for Core {
    fn info(&self)->ConnectionInfo {self.info.clone()}
    fn catalog(&self)->BoxFuture<'_,Result<Catalog,String>> {Box::pin(async move {
        let mut workspaces=Vec::new(); let mut sessions=Vec::new(); let mut cursor=None::<String>; let mut seen=HashSet::new(); let mut cursors=HashSet::new();
        for _ in 0..10 {
            let mut path="api/client/v1/projects?limit=100".to_string();
            if let Some(c)=&cursor {path.push_str("&cursor=");path.push_str(&urlencoding::encode(c));}
            let value=self.get(&path).await?; let items=value["items"].as_array().ok_or(PROTOCOL)?;
            if items.len()>100 {return Err("REMOTE_LIMIT".into());}
            for item in items {
                let project_id=string(item,"id")?; self.project(project_id)?;
                if !seen.insert(project_id.to_owned()) {return Err(PROTOCOL.into());}
                let title=string(item,"name")?; if title.len()>4096 {return Err("REMOTE_LIMIT".into());}
                workspaces.push(RemoteWorkspace{workspace_id:project_id.into(),title:title.into(),session_ids:vec![project_id.into()]});
                sessions.push(RemoteSession{session_id:project_id.into(),title:title.into(),running:false,updated_at:item["updated_at"].as_f64().unwrap_or(0.0)});
            }
            let more=value["has_more"].as_bool().ok_or(PROTOCOL)?;
            if !more {return Ok(Catalog{workspaces,sessions});}
            let next=string(&value,"next_cursor")?.to_owned();
            if next.len()>4096 || items.is_empty() || !cursors.insert(next.clone()) {return Err(PROTOCOL.into());} cursor=Some(next);
        }
        Err("REMOTE_LIMIT".into())
    })}
    fn history<'a>(&'a self,session_id:&'a str)->BoxFuture<'a,Result<History,String>> {Box::pin(async move {
        let page=self.messages(session_id,0).await?;
        Ok(History{session_id:page.session_id,messages:page.messages,has_more:page.has_more,omitted_records:0})
    })}
    fn core_messages<'a>(&'a self,project_id:&'a str,after:u64)->BoxFuture<'a,Result<CoreMessagePage,String>> {Box::pin(self.messages(project_id,after))}
    fn core_tasks<'a>(&'a self,project_id:&'a str,cursor:Option<String>)->BoxFuture<'a,Result<Value,String>> {Box::pin(async move {
        self.project(project_id)?;
        let mut path=format!("api/client/v1/projects/{project_id}/tasks?limit=100");
        if let Some(c)=cursor {if c.len()>4096 {return Err(PROTOCOL.into());}path.push_str("&cursor=");path.push_str(&urlencoding::encode(&c));}
        let value=self.get(&path).await?;
        let items=value["items"].as_array().ok_or(PROTOCOL)?;
        if items.len()>100 {return Err("REMOTE_LIMIT".into());}
        let mut safe=Vec::new(); let mut seen=HashSet::new();
        for item in items {
            let task_id=string(item,"id")?; id(task_id)?;
            if item["project_id"]!=project_id || !seen.insert(task_id) {return Err(PROTOCOL.into());}
            safe.push(select(item,&["id","project_id","title","status","created_at","updated_at"])?);
        }
        let more=value["has_more"].as_bool().ok_or(PROTOCOL)?;
        let next=if more {let next=string(&value,"next_cursor")?;if next.len()>4096 || items.is_empty(){return Err(PROTOCOL.into());}json!(next)}else{Value::Null};
        Ok(json!({"items":safe,"nextCursor":next,"hasMore":more}))
    })}
    fn core_snapshot<'a>(&'a self,task_id:&'a str)->BoxFuture<'a,Result<Value,String>> {Box::pin(async move {
        id(task_id)?;
        let value=self.get(&format!("api/client/v1/tasks/{task_id}/snapshot")).await?;
        if value["task"]["id"]!=task_id {return Err(PROTOCOL.into());}
        self.project(string(&value["task"],"project_id")?)?;
        let executions=value["executions"].as_array().ok_or(PROTOCOL)?;
        let mut execution_ids=HashSet::new();
        for execution in executions {
            let execution_id=string(execution,"id")?; id(execution_id)?;
            if execution["task_id"]!=task_id || !execution_ids.insert(execution_id) {return Err(PROTOCOL.into());}
        }
        for key in ["verifications","reviews","artifacts","steering"] {
            for child in value[key].as_array().ok_or(PROTOCOL)? {
                if let Some(child_task)=child.get("task_id") {if !child_task.is_null() && child_task!=task_id {return Err(PROTOCOL.into());}}
                if let Some(execution_id)=child.get("execution_id").filter(|v|!v.is_null()) {
                    if !execution_ids.contains(execution_id.as_str().ok_or(PROTOCOL)?) {return Err(PROTOCOL.into());}
                }
            }
        }
        // Only server allowlisted fields are surfaced; raw metadata/paths/logs stay out.
        let task=select(&value["task"],&["id","project_id","title","status"])?;
        let mut safe=json!({"task":task,"observedAt":value["observed_at"].as_u64().ok_or(PROTOCOL)?});
        for (key,fields) in [
            ("executions",vec!["id","task_id","status","iteration"]),
            ("verifications",vec!["id","execution_id","status","checks_total","checks_passed"]),
            ("reviews",vec!["id","execution_id","status","decision"]),
            ("artifacts",vec!["id","execution_id","name","type"]),
            ("steering",vec!["id","execution_id","status"])
        ] {
            let items=value[key].as_array().ok_or(PROTOCOL)?; if items.len()>1000 {return Err("REMOTE_LIMIT".into());}
            safe[key]=Value::Array(items.iter().map(|v|select(v,&fields)).collect::<Result<Vec<_>,_>>()?);
        }
        safe["missingFacts"]=Value::Array(value["missing_facts"].as_array().ok_or(PROTOCOL)?.iter().map(|v| {
            let s=v.as_str().ok_or(PROTOCOL)?; if s.len()>1000 {return Err("REMOTE_LIMIT".to_string());} Ok(json!(s))
        }).collect::<Result<Vec<_>,String>>()?);
        Ok(safe)
    })}
    fn watch<'a>(&'a self,_:&'a str)->BoxFuture<'a,Result<LiveView,String>> {Box::pin(async{Err("REMOTE_UNSUPPORTED_CAPABILITY".into())})}
    fn live(&self,_:&str)->Result<LiveView,String>{Err("REMOTE_UNSUPPORTED_CAPABILITY".into())}
    fn action(&self,_:super::ActionInput)->BoxFuture<'_,Result<LiveView,String>>{Box::pin(async{Err("REMOTE_UNSUPPORTED_CAPABILITY".into())})}
    fn close(&self){self.alive.store(false,Ordering::SeqCst);}
}
fn select(value:&Value,fields:&[&str])->Result<Value,String>{
    let object=value.as_object().ok_or(PROTOCOL)?; let mut result=serde_json::Map::new();
    for field in fields {if let Some(v)=object.get(*field) {if v.is_object()||v.is_array()||v.as_str().is_some_and(|s|s.len()>4096){return Err(PROTOCOL.into());} result.insert((*field).into(),v.clone());}}
    Ok(Value::Object(result))
}

#[cfg(test)]
#[path="core_tests.rs"]
mod tests;
