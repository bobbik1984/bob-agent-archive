use super::*;
use axum::{extract::State, http::StatusCode as Code, response::IntoResponse, routing::{get,post}, Json, Router};
use std::sync::Arc;
use tokio::sync::Mutex;

struct Fixture { credential:CoreCredential, base:Mutex<String>, challenge:Mutex<String>, mode:std::sync::atomic::AtomicU8,
    exchange_started:tokio::sync::Notify, exchange_release:tokio::sync::Notify, revocations:std::sync::atomic::AtomicUsize }
fn credential()->CoreCredential {CoreCredential{access_token:URL_SAFE_NO_PAD.encode([7;32]),credential_id:"credential-one".into(),principal_id:"principal-one".into(),server_instance_id:"server-one".into(),expires_at:now_ms()+3600000,grants:vec![Grant{project_id:"project-one".into(),scopes:vec!["work.read".into()]}]}}
async fn server()->(String,Arc<Fixture>,tokio::task::JoinHandle<()>) {
    let f=Arc::new(Fixture{credential:credential(),base:Mutex::new(String::new()),challenge:Mutex::new(String::new()),mode:std::sync::atomic::AtomicU8::new(0),exchange_started:tokio::sync::Notify::new(),exchange_release:tokio::sync::Notify::new(),revocations:std::sync::atomic::AtomicUsize::new(0)});
    async fn begin(State(f):State<Arc<Fixture>>,Json(body):Json<Value>)->impl IntoResponse {
        assert_eq!(body["challenge_method"],"S256");assert_eq!(body["protocol_version"],VERSION);
        *f.challenge.lock().await=body["challenge"].as_str().unwrap().into();
        (Code::CREATED,Json(json!({"pairing_id":"pairing-one","user_code":"123456789A","verification_uri":format!("{}/client-connect",f.base.lock().await),"expires_at":now_ms()+600000,"interval_ms":5000})))
    }
    async fn exchange(State(f):State<Arc<Fixture>>,Json(body):Json<Value>)->impl IntoResponse {
        let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(body["verifier"].as_str().unwrap().as_bytes()));
        assert_eq!(challenge,*f.challenge.lock().await);
        if f.mode.load(Ordering::SeqCst)==4 {f.exchange_started.notify_one();f.exchange_release.notified().await;}
        if f.mode.load(Ordering::SeqCst)==5 {return (Code::SERVICE_UNAVAILABLE,Json(json!({"error":"consumed-but-response-lost"})));}
        let mut v=serde_json::to_value(&f.credential).unwrap();v["token_type"]=json!("Bearer");(Code::OK,Json(v))
    }
    async fn caps(State(f):State<Arc<Fixture>>)->impl IntoResponse {
        if f.mode.load(Ordering::SeqCst)==1{return (Code::UNAUTHORIZED,Json(json!({"code":"AUTH"})));}
        (Code::OK,Json(json!({"protocol_version":VERSION,"server_instance_id":f.credential.server_instance_id,"principal_id":f.credential.principal_id,"credential_id":f.credential.credential_id,"expires_at":f.credential.expires_at,"grants":f.credential.grants,"capabilities":{"catalog":true,"history":true,"submit":true}})))
    }
    async fn projects(State(f):State<Arc<Fixture>>)->impl IntoResponse {
        match f.mode.load(Ordering::SeqCst) {
            1=>(Code::UNAUTHORIZED,Json(json!({}))),
            _=>(Code::OK,Json(json!({"items":[{"id":"project-one","name":"Demo"}],"next_cursor":null,"has_more":false})))
        }
    }
    async fn messages(State(f):State<Arc<Fixture>>)->impl IntoResponse {
        let sequence=if f.mode.load(Ordering::SeqCst)==2 {0}else{1};
        Json(json!({"items":[{"sequence":sequence,"id":"message-one","project_id":"project-one","task_id":"task-one","role":"assistant","content":"Visible answer"}],"next_after":sequence,"has_more":false}))
    }
    async fn snapshot(State(f):State<Arc<Fixture>>)->impl IntoResponse {
        let parent=if f.mode.load(Ordering::SeqCst)==3 {"other-task"}else{"task-one"};
        Json(json!({"task":{"id":"task-one","project_id":"project-one","status":"running","title":"Demo"},"executions":[{"id":"execution-one","task_id":parent,"status":"running"}],"artifacts":[],"reviews":[],"verifications":[],"steering":[],"observed_at":now_ms(),"missing_facts":["model_identity"]}))
    }
    let router=Router::new().route("/api/client/v1/pairings",post(begin)).route("/api/client/v1/pairings/pairing-one/exchange",post(exchange))
        .route("/api/client/v1/capabilities",get(caps)).route("/api/client/v1/projects",get(projects))
        .route("/api/client/v1/projects/project-one/messages",get(messages)).route("/api/client/v1/tasks/task-one/snapshot",get(snapshot))
        .route("/api/client/v1/credentials/self/revoke",post(|State(f):State<Arc<Fixture>>|async move{f.revocations.fetch_add(1,Ordering::SeqCst);Code::NO_CONTENT})).with_state(f.clone());
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let base=format!("http://{}",listener.local_addr().unwrap());*f.base.lock().await=base.clone();
    let handle=tokio::spawn(async move{axum::serve(listener,router).await.unwrap()});(base,f,handle)
}

#[test]
fn strict_endpoint_and_ttl() {
    for url in ["https://user:pass@demo.test","https://demo.test/path","https://demo.test/?token=x","https://localhost","https://127.0.0.1","https://demo.test/#secret","http://demo.test"] {assert!(endpoint(url).is_err(),"{url}");}
    assert!(endpoint("https://demo.test").is_ok());
    let mut c=credential();c.expires_at=now_ms()+25*3600000;assert!(c.validate().is_err());c.expires_at=now_ms()-1;assert_eq!(c.validate().unwrap_err(),"REMOTE_EXPIRED");
}

#[tokio::test]
async fn pairing_challenge_private_and_readonly_projection() {
    let (base,f,handle)=server().await;
    let (mut pairing,info)=Pairing::begin(&base,"Laptop").await.unwrap();
    let public=serde_json::to_string(&info).unwrap();assert!(!public.contains(&pairing.verifier));assert!(!public.contains("access_token"));
    let expected=format!("{:x}",Sha256::digest(f.challenge.lock().await.as_bytes()));assert_eq!(info.challenge_fingerprint,expected[..12]);
    assert!(pairing.poll().await.unwrap().is_none());pairing.next_poll=0;
    let c=pairing.poll().await.unwrap().unwrap();let core=Core::connect(&base,c,None).await.unwrap();
    assert!(!core.info().capabilities.send);assert!(!serde_json::to_string(&core.info()).unwrap().contains(&f.credential.access_token));
    assert_eq!(core.catalog().await.unwrap().sessions[0].session_id,"project-one");
    assert_eq!(core.history("project-one").await.unwrap().messages[0].text,"Visible answer");
    assert_eq!(core.history("ungranted").await.err().unwrap(),"REMOTE_FORBIDDEN");
    assert_eq!(core.core_snapshot("task-one").await.unwrap()["executions"][0]["id"],"execution-one");
    assert_eq!(core.watch("project-one").await.err().unwrap(),"REMOTE_UNSUPPORTED_CAPABILITY");
    f.mode.store(2,Ordering::SeqCst);assert_eq!(core.history("project-one").await.err().unwrap(),PROTOCOL);
    f.mode.store(3,Ordering::SeqCst);assert_eq!(core.core_snapshot("task-one").await.err().unwrap(),PROTOCOL);
    f.mode.store(1,Ordering::SeqCst);assert_eq!(core.catalog().await.err().unwrap(),"REMOTE_AUTH");assert_eq!(core.catalog().await.err().unwrap(),"REMOTE_DISCONNECTED");
    handle.abort();
}

#[test]
fn typed_vault_preserves_dsh_and_encrypted_rollback() {
    let root=std::env::temp_dir().join(format!("bob-core-vault-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&root).unwrap();let path=root.join("vault.db");
    let mut v=super::super::store::Vault::unlock(path.clone(),"test-password-123").unwrap();
    let dsh=v.save("DSH".into(),"https://demo.test".into(),"fake-cookie".into()).unwrap();let original=std::fs::read(&path).unwrap();
    let c=credential();let p=v.save_core("Core".into(),"https://demo.test".into(),c.clone()).unwrap();
    assert_ne!(p.id,dsh.id);assert_eq!(v.credential(&dsh.id).unwrap().1,"fake-cookie");assert!(v.credential(&p.id).is_err());
    assert_eq!(std::fs::read(path.with_extension("pre-core.db")).unwrap(),original);
    assert!(!String::from_utf8_lossy(&std::fs::read(&path).unwrap()).contains(&c.access_token));drop(v);
    let v=super::super::store::Vault::unlock(path,"test-password-123").unwrap();assert_eq!(v.list().len(),2);assert!(matches!(v.typed_credential(&p.id).unwrap().1,super::super::store::Credential::CoreCredential(_)));drop(v);std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cancel_inflight_exchange_revokes_without_late_connection() {
    use super::super::*;
    let (base,f,handle)=server().await;
    let dir=std::env::temp_dir().join(format!("bob-core-race-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&dir).unwrap();
    *store::VAULT.lock().await=Some(store::Vault::unlock(dir.join("vault.db"),"test-password-123").unwrap());
    let info=remote_agent_core_pair_begin(base,"Cancel test".into()).await.unwrap();
    let pending=CORE_PAIRINGS.lock().await.get(&info.pairing_id).unwrap().clone();pending.pairing.lock().await.next_poll=0;
    f.mode.store(4,Ordering::SeqCst);
    let id=info.pairing_id.clone();let poll=tokio::spawn(async move{remote_agent_core_pair_poll(id).await});
    tokio::time::timeout(Duration::from_secs(2),f.exchange_started.notified()).await.unwrap();
    let cancel=tokio::spawn(async move{remote_agent_core_pair_cancel(info.pairing_id).await});
    tokio::time::timeout(Duration::from_secs(2),async{while !pending.cancelled.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.unwrap();
    f.exchange_release.notify_one();
    assert_eq!(poll.await.unwrap().err().unwrap(),"REMOTE_STALE");cancel.await.unwrap().unwrap();
    assert_eq!(f.revocations.load(Ordering::SeqCst),1);assert!(CONNECTIONS.lock().await.is_empty());assert!(store::VAULT.lock().await.as_ref().unwrap().list().is_empty());
    remote_agent_lock().await.unwrap();handle.abort();std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn consumed_exchange_with_failed_response_requires_site_review() {
    let (base,f,handle)=server().await;let(mut p,_)=Pairing::begin(&base,"Test" ).await.unwrap();p.next_poll=0;f.mode.store(5,Ordering::SeqCst);
    assert_eq!(p.poll().await.err().unwrap(),"REMOTE_PAIRING_REVOKE_REQUIRED");handle.abort();
}

#[tokio::test]
async fn lock_inflight_exchange_revokes_and_keeps_vault_locked() {
    use super::super::*;
    let(base,f,handle)=server().await;
    let dir=std::env::temp_dir().join(format!("bob-core-lock-race-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&dir).unwrap();
    *store::VAULT.lock().await=Some(store::Vault::unlock(dir.join("vault.db"),"test-password-123").unwrap());
    let info=remote_agent_core_pair_begin(base,"Lock test".into()).await.unwrap();
    let pending=CORE_PAIRINGS.lock().await.get(&info.pairing_id).unwrap().clone();pending.pairing.lock().await.next_poll=0;
    f.mode.store(4,Ordering::SeqCst);
    let poll=tokio::spawn(async move{remote_agent_core_pair_poll(info.pairing_id).await});
    tokio::time::timeout(Duration::from_secs(2),f.exchange_started.notified()).await.unwrap();
    let lock=tokio::spawn(remote_agent_lock());
    tokio::time::timeout(Duration::from_secs(2),async{while !pending.cancelled.load(Ordering::SeqCst){tokio::task::yield_now().await;}}).await.unwrap();
    f.exchange_release.notify_one();assert_eq!(poll.await.unwrap().err().unwrap(),"REMOTE_STALE");lock.await.unwrap().unwrap();
    assert_eq!(f.revocations.load(Ordering::SeqCst),1);assert!(CONNECTIONS.lock().await.is_empty());assert!(store::VAULT.lock().await.is_none());
    assert!(store::Vault::unlock(dir.join("vault.db"),"test-password-123").unwrap().list().is_empty());
    handle.abort();std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
#[ignore = "requires explicit loopback compiled Core HTTP fixture"]
async fn actual_online_http_contract_interop() {
    let base=std::env::var("BOB_CORE_TEST_URL").expect("run harness --core-fixture");
    assert!(base.starts_with("http://127.0.0.1:"));
    let(mut pairing,info)=Pairing::begin(&base,"Native interoperability test").await.unwrap();
    let admin=client().unwrap();
    let describe:Value=admin.get(format!("{base}/api/work/client-authorizations?user_code={}",info.user_code))
        .header("x-test-admin","fake-approved-admin").send().await.unwrap().json().await.unwrap();
    assert_eq!(describe["pairing"]["challenge_fingerprint"],info.challenge_fingerprint);
    let approved=admin.post(format!("{base}/api/work/client-authorizations/{}/approve",info.pairing_id))
        .header("x-test-admin","fake-approved-admin").header("x-bob-client-csrf","fake-csrf").header("origin",&base)
        .json(&json!({"user_code":info.user_code,"project_ids":["proj_a"]})).send().await.unwrap();
    assert_eq!(approved.status(),StatusCode::OK);
    pairing.next_poll=0;let credential=pairing.poll().await.unwrap().unwrap();
    let core=Core::connect(&base,credential.clone(),None).await.unwrap();
    assert_eq!(core.catalog().await.unwrap().sessions[0].session_id,"proj_a");
    assert_eq!(core.core_tasks("proj_a",None).await.unwrap()["items"][0]["id"],"task_a");
    let page=core.core_messages("proj_a",0).await.unwrap();assert_eq!(page.next_after,1);assert_eq!(page.messages[0].text,"Fixture history");
    assert!(core.core_messages("proj_a",page.next_after).await.unwrap().messages.is_empty());
    assert_eq!(core.core_snapshot("task_a").await.unwrap()["executions"][0]["id"],"exec_a");
    Core::revoke(&base,&credential).await.unwrap();assert_eq!(core.catalog().await.err().unwrap(),"REMOTE_AUTH");
}
