//! Native remote-Agent boundary. No startup work or local RPC fallback.
//! Saved credentials stay in the independent, explicitly unlocked encrypted local vault.
//! Adapter capabilities describe this client's implemented surface, not the host's full authority.
mod dsh;
mod core;
mod live;
mod store;
mod system_protection;
pub use live::LiveView;

use futures_util::future::BoxFuture;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub catalog: bool,
    pub history: bool,
    pub send: bool,
    pub approvals: bool,
    pub artifacts: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub connection_id: String,
    pub profile_id: Option<String>,
    pub adapter: String,
    pub endpoint: String,
    pub capabilities: Capabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub core: Option<core::CoreIdentity>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspace {
    pub workspace_id: String,
    pub title: String,
    pub session_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSession {
    pub session_id: String,
    pub title: String,
    pub running: bool,
    pub updated_at: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub workspaces: Vec<RemoteWorkspace>,
    pub sessions: Vec<RemoteSession>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactItem {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub kind: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolCallItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<ArtifactItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub session_id: String,
    pub messages: Vec<HistoryMessage>,
    pub has_more: bool,
    /// Non-text records are deliberately not passed into Bob's local HTML/file renderer.
    pub omitted_records: usize,
}

pub trait RemoteAgent: Send + Sync {
    fn info(&self) -> ConnectionInfo;
    fn catalog(&self) -> BoxFuture<'_, Result<Catalog, String>>;
    fn history<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, Result<History, String>>;
    fn watch<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, Result<LiveView, String>>;
    fn live(&self, watch_id: &str) -> Result<LiveView, String>;
    fn action(&self, input: ActionInput) -> BoxFuture<'_, Result<LiveView, String>>;
    fn core_messages<'a>(&'a self, _project_id: &'a str, _after: u64) -> BoxFuture<'a, Result<core::CoreMessagePage, String>> {
        Box::pin(async { Err("REMOTE_UNSUPPORTED_CAPABILITY".into()) })
    }
    fn core_snapshot<'a>(&'a self, _task_id: &'a str) -> BoxFuture<'a, Result<serde_json::Value, String>> {
        Box::pin(async { Err("REMOTE_UNSUPPORTED_CAPABILITY".into()) })
    }
    fn core_tasks<'a>(&'a self, _project_id: &'a str, _cursor: Option<String>) -> BoxFuture<'a, Result<serde_json::Value,String>> {
        Box::pin(async { Err("REMOTE_UNSUPPORTED_CAPABILITY".into()) })
    }
    fn close(&self);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionInput {
    pub watch_id: String,
    pub kind: String,
    pub request_id: Option<String>,
    pub text: Option<String>,
    pub event_id: Option<String>,
    pub answer: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn remote_agent_watch(
    connection_id: String,
    session_id: String,
) -> Result<LiveView, String> {
    if session_id.is_empty() || session_id.len() > 512 {
        return Err("REMOTE_PROTOCOL".into());
    }
    get(&connection_id).await?.watch(&session_id).await
}

#[tauri::command]
pub async fn remote_agent_live(
    connection_id: String,
    watch_id: String,
) -> Result<LiveView, String> {
    get(&connection_id).await?.live(&watch_id)
}

#[tauri::command]
pub async fn remote_agent_action(
    connection_id: String,
    input: ActionInput,
) -> Result<LiveView, String> {
    let adapter = get(&connection_id).await?;
    let profile_id = adapter.info().profile_id;
    let session = adapter.live(&input.watch_id)?.session_id;
    let guarded = input.kind == "send" || input.kind == "answer";
    if let Some(id) = profile_id.as_ref().filter(|_| guarded) {
        let mut guard = store::VAULT.lock().await;
        let vault = store::unlocked(&mut guard)?;
        if vault.credential(id)?.0.uncertain_sessions.contains(&session) { return Err("REMOTE_REVIEW_REQUIRED".into()); }
        vault.update(id, None, None, Some((session.clone(), true)))?;
    }
    let result = adapter.action(input).await;
    if let (Some(id), Ok(view)) = (profile_id.as_ref().filter(|_| guarded), &result) {
        if view.phase != "unknown" {
            let mut guard = store::VAULT.lock().await;
            store::unlocked(&mut guard)?.update(id, None, None, Some((session, false)))?;
        }
    }
    result
}

static CONNECTIONS: Lazy<Mutex<HashMap<String, Arc<dyn RemoteAgent>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Serialize vault changes and reconnect publication; a forgotten/locked profile cannot reappear.
static PROFILE_OPERATIONS: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Serialize)]
pub struct ProfileList { pub unlocked: bool, pub profiles: Vec<store::Profile> }

#[tauri::command]
pub async fn remote_agent_profiles() -> Result<ProfileList, String> {
    let guard = store::VAULT.lock().await;
    Ok(ProfileList { unlocked: guard.is_some(), profiles: guard.as_ref().map(|v| v.list()).unwrap_or_default() })
}

#[tauri::command]
pub async fn remote_agent_unlock(app: tauri::AppHandle, legacy_password: Option<String>) -> Result<ProfileList, String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    let path = crate::get_data_dir().join("remote-agent-vault.db");
    let vault = tokio::task::spawn_blocking(move || store::Vault::unlock_system(path, legacy_password.as_deref(), |envelope| system_protection::unlock(&app, envelope)))
        .await.map_err(|_| "REMOTE_STORAGE")??;
    *store::VAULT.lock().await = Some(vault);
    remote_agent_profiles().await
}

#[tauri::command]
pub async fn remote_agent_lock() -> Result<(), String> {
    cancel_pending_core().await;
    let _operation = PROFILE_OPERATIONS.lock().await;
    let pending:Vec<_>=CORE_PAIRINGS.lock().await.values().cloned().collect();
    let mut cleanup_error=None;
    for item in pending {
        if item.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            if let Some(profile)=item.published.lock().await.take() {
                if let Err(error)=revoke_core_profile(&profile).await {cleanup_error=Some(error);}
            }
        }
    }
    for (_, adapter) in CONNECTIONS.lock().await.drain() { adapter.close(); }
    *store::VAULT.lock().await = None;
    CORE_PAIRINGS.lock().await.clear();
    if let Some(error)=cleanup_error {Err(error)} else {Ok(())}
}

async fn register(adapter: Arc<dyn RemoteAgent>) -> Result<ConnectionInfo, String> {
    let info = adapter.info();
    let mut connections = CONNECTIONS.lock().await;
    if let Some(id) = &info.profile_id {
        connections.retain(|_, old| {
            if old.info().profile_id.as_ref() == Some(id) { old.close(); false } else { true }
        });
    }
    if connections.len() >= 4 { adapter.close(); return Err("REMOTE_CONNECTION_LIMIT".into()); }
    connections.insert(info.connection_id.clone(), adapter);
    Ok(info)
}

#[tauri::command]
pub async fn remote_agent_save(input: ConnectInput, name: String) -> Result<ConnectionInfo, String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    if input.adapter != "dsh" { return Err("REMOTE_UNSUPPORTED_ADAPTER".into()); }
    { let mut guard = store::VAULT.lock().await; store::unlocked(&mut guard)?; }
    let mut adapter = dsh::Dsh::connect(&input.endpoint, &input.token).await?;
    let result = {
        let mut guard = store::VAULT.lock().await;
        store::unlocked(&mut guard)?.save(name, adapter.info().endpoint, adapter.credential())
    };
    let profile = match result { Ok(profile) => profile, Err(e) => { adapter.close(); return Err(e); } };
    adapter.set_profile(profile.id);
    register(Arc::new(adapter)).await
}

#[tauri::command]
pub async fn remote_agent_reconnect(profile_id: String) -> Result<ConnectionInfo, String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    let (profile, credential) = {
        let mut guard = store::VAULT.lock().await; store::unlocked(&mut guard)?.typed_credential(&profile_id)?
    };
    match credential {
        store::Credential::DshCookie(cookie) => {
            let mut adapter = dsh::Dsh::reconnect(&profile.endpoint, cookie).await?;
            adapter.set_profile(profile.id); register(Arc::new(adapter)).await
        }
        store::Credential::CoreCredential(credential) => {
            let adapter = core::Core::connect(&profile.endpoint, credential, Some(profile.id)).await?;
            register(Arc::new(adapter)).await
        }
    }
}

#[tauri::command]
pub async fn remote_agent_profile_update(profile_id: String, session_id: Option<String>, auto_reconnect: Option<bool>, reviewed_session: Option<String>) -> Result<(), String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    let mut guard = store::VAULT.lock().await;
    store::unlocked(&mut guard)?.update(&profile_id, session_id, auto_reconnect, reviewed_session.map(|s| (s,false)))
}

#[tauri::command]
pub async fn remote_agent_forget(profile_id: String) -> Result<(), String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    let mut guard = store::VAULT.lock().await;
    store::unlocked(&mut guard)?.forget(&profile_id)?;
    CONNECTIONS.lock().await.retain(|_, adapter| {
        if adapter.info().profile_id.as_ref() == Some(&profile_id) { adapter.close(); false } else { true }
    });
    Ok(())
}

// Do not derive Debug/Serialize: input contains a user credential.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInput {
    pub adapter: String,
    pub endpoint: String,
    pub token: String,
}

#[tauri::command]
pub async fn remote_agent_connect(input: ConnectInput) -> Result<ConnectionInfo, String> {
    if input.adapter != "dsh" {
        return Err("REMOTE_UNSUPPORTED_ADAPTER".into());
    }
    let adapter: Arc<dyn RemoteAgent> =
        Arc::new(dsh::Dsh::connect(&input.endpoint, &input.token).await?);
    let info = adapter.info();
    let mut connections = CONNECTIONS.lock().await;
    if connections.len() >= 4 {
        adapter.close();
        return Err("REMOTE_CONNECTION_LIMIT".into());
    }
    connections.insert(info.connection_id.clone(), adapter);
    Ok(info)
}

async fn get(connection_id: &str) -> Result<Arc<dyn RemoteAgent>, String> {
    CONNECTIONS
        .lock()
        .await
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "REMOTE_DISCONNECTED".into())
}

#[tauri::command]
pub async fn remote_agent_catalog(connection_id: String) -> Result<Catalog, String> {
    get(&connection_id).await?.catalog().await
}

#[tauri::command]
pub async fn remote_agent_history(
    connection_id: String,
    session_id: String,
) -> Result<History, String> {
    if session_id.is_empty() || session_id.len() > 512 {
        return Err("REMOTE_PROTOCOL".into());
    }
    get(&connection_id).await?.history(&session_id).await
}

#[tauri::command]
pub async fn remote_agent_disconnect(connection_id: String) -> Result<(), String> {
    if let Some(adapter) = CONNECTIONS.lock().await.remove(&connection_id) {
        adapter.close();
    }
    Ok(())
}

struct PendingCore {
    pairing: Mutex<core::Pairing>,
    cancelled: std::sync::atomic::AtomicBool,
    published: Mutex<Option<String>>,
    finished: std::sync::atomic::AtomicBool,
}
static CORE_PAIRINGS: Lazy<Mutex<HashMap<String, Arc<PendingCore>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

async fn cancel_pending_core() {
    for pending in CORE_PAIRINGS.lock().await.values() {
        if !pending.finished.load(std::sync::atomic::Ordering::SeqCst) {pending.cancelled.store(true, std::sync::atomic::Ordering::SeqCst);}
    }
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CorePairingResult { pub status: String, #[serde(skip_serializing_if="Option::is_none")] pub connection: Option<ConnectionInfo> }

#[tauri::command]
pub async fn remote_agent_core_pair_begin(endpoint: String, name: String) -> Result<core::PairingInfo, String> {
    let _operation = PROFILE_OPERATIONS.lock().await;
    { let mut vault = store::VAULT.lock().await; store::unlocked(&mut vault)?; }
    let mut pending = CORE_PAIRINGS.lock().await;
    // One pending authorization per app prevents hidden stale approvals.
    pending.retain(|_,p| !p.finished.load(std::sync::atomic::Ordering::SeqCst));
    if !pending.is_empty() { return Err("REMOTE_BUSY".into()); }
    let (pairing, info) = core::Pairing::begin(&endpoint,&name).await?;
    pending.insert(info.pairing_id.clone(),Arc::new(PendingCore{pairing:Mutex::new(pairing),cancelled:std::sync::atomic::AtomicBool::new(false),published:Mutex::new(None),finished:std::sync::atomic::AtomicBool::new(false)}));
    Ok(info)
}

#[tauri::command]
pub async fn remote_agent_core_pair_cancel(pairing_id: String) -> Result<(),String> {
    let pending = CORE_PAIRINGS.lock().await.get(&pairing_id).cloned();
    if let Some(pending) = pending {
        pending.cancelled.store(true,std::sync::atomic::Ordering::SeqCst);
        // Poll owns PROFILE_OPERATIONS while a token might be in flight. Wait until
        // it has persisted or revoked that token before discarding the verifier.
        let _operation = PROFILE_OPERATIONS.lock().await;
        let profile=pending.published.lock().await.take();
        let result=if let Some(profile)=profile {revoke_core_profile(&profile).await} else {Ok(())};
        CORE_PAIRINGS.lock().await.remove(&pairing_id);
        result?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_agent_core_pair_poll(pairing_id: String) -> Result<CorePairingResult,String> {
    let pending = CORE_PAIRINGS.lock().await.get(&pairing_id).cloned().ok_or("REMOTE_STALE")?;
    let _operation = PROFILE_OPERATIONS.lock().await;
    let mut pairing = pending.pairing.lock().await;
    if pending.cancelled.load(std::sync::atomic::Ordering::SeqCst) || pending.finished.load(std::sync::atomic::Ordering::SeqCst) { pending.finished.store(true,std::sync::atomic::Ordering::SeqCst); return Err("REMOTE_STALE".into()); }
    { let mut vault = store::VAULT.lock().await; store::unlocked(&mut vault)?; }
    let result = pairing.poll().await;
    let credential = match result {
        Ok(None) => return Ok(CorePairingResult{status:"pending".into(),connection:None}),
        Ok(Some(credential)) => credential,
        Err(error) => { pending.finished.store(true,std::sync::atomic::Ordering::SeqCst); return Err(error); }
    };
    let endpoint = pairing.base.origin().ascii_serialization();
    let saved = {
        let mut vault = store::VAULT.lock().await;
        store::unlocked(&mut vault)?.save_core(pairing.name.clone(),endpoint.clone(),credential.clone())
    };
    let profile = match saved {
            Ok(profile) => profile,
            Err(_) => {
                let revoked = core::Core::revoke(&endpoint,&credential).await.is_ok();
                pending.finished.store(true,std::sync::atomic::Ordering::SeqCst);
                return Err(if revoked { "REMOTE_STORAGE" } else { "REMOTE_PAIRING_REVOKE_REQUIRED" }.into());
            }
    };
    *pending.published.lock().await=Some(profile.id.clone());
    let result = core::Core::connect(&endpoint,credential.clone(),Some(profile.id.clone())).await;
    if pending.cancelled.load(std::sync::atomic::Ordering::SeqCst) || result.is_err() {
        let cleanup=revoke_core_profile(&profile.id).await;
        *pending.published.lock().await=None;
        pending.finished.store(true,std::sync::atomic::Ordering::SeqCst);
        cleanup?;
        return Err(result.err().unwrap_or_else(||"REMOTE_STALE".into()));
    }
    let connected = register(Arc::new(result?)).await;
    if connected.is_err() || pending.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
        let cleanup=revoke_core_profile(&profile.id).await;
        *pending.published.lock().await=None;
        pending.finished.store(true,std::sync::atomic::Ordering::SeqCst);
        cleanup?; return Err(connected.err().unwrap_or_else(||"REMOTE_STALE".into()));
    }
    pending.finished.store(true,std::sync::atomic::Ordering::SeqCst);
    // Retain the completed receipt until cancel/next begin: a late UI cancel still
    // closes the connection and revokes the issued credential.
    Ok(CorePairingResult{status:"connected".into(),connection:Some(connected?)})
}

#[tauri::command]
pub async fn remote_agent_core_revoke(profile_id:String)->Result<(),String> {
    let _operation=PROFILE_OPERATIONS.lock().await;
    revoke_core_profile(&profile_id).await
}
async fn revoke_core_profile(profile_id:&str)->Result<(),String> {
    let (profile,credential)={let mut guard=store::VAULT.lock().await;store::unlocked(&mut guard)?.typed_credential(&profile_id)?};
    let credential=match credential {store::Credential::CoreCredential(c)=>c,_=>return Err("REMOTE_UNSUPPORTED_ADAPTER".into())};
    CONNECTIONS.lock().await.retain(|_,adapter|{if adapter.info().profile_id.as_deref()==Some(profile_id){adapter.close();false}else{true}});
    let revoked=core::Core::revoke(&profile.endpoint,&credential).await;
    let mut guard=store::VAULT.lock().await;
    let vault=store::unlocked(&mut guard)?;
    if revoked.is_ok() {vault.forget(profile_id)} else {
        vault.update(profile_id,None,Some(false),None)?;
        Err("REMOTE_PAIRING_REVOKE_REQUIRED".into())
    }
}

#[tauri::command]
pub async fn remote_agent_core_messages(connection_id:String,project_id:String,after:u64)->Result<core::CoreMessagePage,String> {
    get(&connection_id).await?.core_messages(&project_id,after).await
}

#[tauri::command]
pub async fn remote_agent_core_snapshot(connection_id:String,task_id:String)->Result<serde_json::Value,String> {
    get(&connection_id).await?.core_snapshot(&task_id).await
}

#[tauri::command]
pub async fn remote_agent_core_tasks(connection_id:String,project_id:String,cursor:Option<String>)->Result<serde_json::Value,String> {
    get(&connection_id).await?.core_tasks(&project_id,cursor).await
}
