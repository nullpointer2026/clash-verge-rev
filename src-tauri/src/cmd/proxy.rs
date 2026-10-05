use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, PrfOption, profiles::PROFILE_WRITE_LOCK},
    core::{
        CoreManager,
        handle::Handle,
        proxy_view::{ProxyViewBuilder, ProxyViewInput, ProxyViewV1},
        tray::Tray,
    },
    process::AsyncHandler,
};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::Mapping;
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri_plugin_mihomo::models::ProxyType;

/// Merges one selection pair into fresh backend state to avoid stale-list overwrites.
#[tauri::command]
pub async fn record_selected_node(group_name: String, node: String) -> CmdResult<()> {
    crate::config::profiles::record_selected_node(&group_name, &node)
        .await
        .stringify_err()
}

#[tauri::command]
pub async fn forget_selected_node(group_name: String) -> CmdResult<()> {
    crate::config::profiles::forget_selected_node(&group_name)
        .await
        .stringify_err()
}

static TRAY_SYNC_RUNNING: AtomicBool = AtomicBool::new(false);
static TRAY_SYNC_PENDING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn change_deleted_nodes(
    index: String,
    names: Vec<String>,
    restore: bool,
) -> CmdResult<crate::core::validate::ValidationOutcome> {
    let profile_write_guard = PROFILE_WRITE_LOCK.lock().await;
    let view = if restore { None } else { Some(get_proxy_view().await?) };
    let requested: HashSet<String> = names.iter().cloned().collect();
    if let Some(view) = &view {
        let available: HashSet<&str> = view
            .records
            .values()
            .filter(|node| {
                !matches!(
                    node.proxy_type,
                    ProxyType::Direct
                        | ProxyType::Reject
                        | ProxyType::RejectDrop
                        | ProxyType::Compatible
                        | ProxyType::Pass
                        | ProxyType::PassRule
                        | ProxyType::Dns
                )
            })
            .map(|node| node.name.as_str())
            .collect();
        if !requested.iter().all(|name| available.contains(name.as_str())) {
            return Err("The node list changed. Refresh and select the nodes again.".into());
        }
    }
    let profiles = Config::profiles().await;
    let profile_uid = index.clone();
    let result = profiles
        .with_data_modify(|mut candidate| async move {
            if candidate.current.as_deref() != Some(profile_uid.as_str()) {
                anyhow::bail!("The active profile changed. Select the nodes again.");
            }
            let original = candidate.clone();
            let item = candidate
                .items
                .as_mut()
                .and_then(|items| {
                    items
                        .iter_mut()
                        .find(|item| item.uid.as_deref() == Some(profile_uid.as_str()))
                })
                .ok_or_else(|| anyhow::anyhow!("Active profile not found"))?;
            let option = item.option.get_or_insert_with(PrfOption::default);
            let deleted = option.deleted_nodes.get_or_insert_with(Vec::new);
            if restore {
                deleted.retain(|name| !requested.contains(name.as_str()));
                option.deleted_providers = Some(vec![]);
            } else {
                deleted.extend(names.iter().cloned().map(Into::into));
                deleted.sort();
                deleted.dedup();
                let emptied = option.deleted_providers.get_or_insert_with(Vec::new);
                if let Some(view) = &view {
                    for provider in &view.providers {
                        let members: Vec<_> = provider
                            .proxy_record_ids
                            .iter()
                            .filter_map(|id| view.records.get(id))
                            .filter(|node| {
                                !matches!(
                                    node.proxy_type,
                                    ProxyType::Direct
                                        | ProxyType::Reject
                                        | ProxyType::RejectDrop
                                        | ProxyType::Compatible
                                        | ProxyType::Pass
                                        | ProxyType::PassRule
                                        | ProxyType::Dns
                                )
                            })
                            .collect();
                        if !members.is_empty() && members.iter().all(|node| requested.contains(&node.name)) {
                            emptied.push(provider.name.clone().into());
                        }
                    }
                }
                emptied.sort();
                emptied.dedup();
                if let Some(selected) = &mut item.selected {
                    selected.retain(|entry| !entry.now.as_deref().is_some_and(|name| requested.contains(name)));
                }
            }
            match CoreManager::global()
                .update_config_forced_with_profiles(&candidate, &original)
                .await?
            {
                Ok(guard) => Ok((candidate, Ok(guard))),
                Err(outcome) => Ok((original, Err(outcome))),
            }
        })
        .await
        .stringify_err()?;
    let config_update_guard = match result {
        Ok(guard) => guard,
        Err(outcome) => return Ok(outcome),
    };
    crate::config::profiles::activate_selected_nodes();
    drop(config_update_guard);
    drop(profile_write_guard);
    Handle::refresh_clash();
    Handle::notify_profile_changed(&index.into());
    Ok(crate::core::validate::ValidationOutcome::Valid)
}

fn runtime_group_order(config: Option<&Mapping>) -> Vec<String> {
    let mut seen = HashSet::new();

    config
        .and_then(|config| config.get("proxy-groups"))
        .and_then(|groups| groups.as_sequence())
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("name"))
        .filter_map(|name| name.as_str())
        .filter(|name| !name.is_empty() && *name != "GLOBAL")
        .filter(|name| seen.insert(*name))
        .map(str::to_owned)
        .collect()
}

#[tauri::command]
pub async fn get_proxy_view() -> CmdResult<ProxyViewV1> {
    let runtime = Config::runtime().await;
    let latest_runtime = runtime.latest_arc();
    let runtime_group_order = runtime_group_order(latest_runtime.config.as_ref());

    let mihomo = Handle::mihomo();
    let (proxies, providers) = tokio::join!(mihomo.get_proxies(), mihomo.get_proxy_providers(),);
    let proxies = proxies.stringify_err()?;

    Ok(ProxyViewBuilder::build(ProxyViewInput {
        runtime_group_order,
        proxies,
        providers: providers.ok(),
    }))
}

#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    if TRAY_SYNC_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        AsyncHandler::spawn(move || async move {
            run_tray_sync_loop().await;
        });
    } else {
        TRAY_SYNC_PENDING.store(true, Ordering::Release);
    }

    Ok(())
}

async fn run_tray_sync_loop() {
    loop {
        match Tray::global().update_menu().await {
            Ok(_) => {
                logging!(debug, Type::Cmd, "Tray proxy selection synced successfully");
            }
            Err(e) => {
                logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e:#}");
            }
        }

        if !TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel) {
            TRAY_SYNC_RUNNING.store(false, Ordering::Release);

            if TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel)
                && TRAY_SYNC_RUNNING
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                continue;
            }

            break;
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_yaml_ng::Value;

    use super::runtime_group_order;

    #[test]
    fn runtime_order_keeps_first_non_empty_non_global_name() {
        let config: Value = serde_yaml_ng::from_str(
            r#"
proxy-groups:
  - name: Beta
  - name: ""
  - name: GLOBAL
  - name: " Alpha "
  - name: Beta
"#,
        )
        .expect("parse runtime");

        assert_eq!(
            runtime_group_order(config.as_mapping()),
            ["Beta".to_owned(), " Alpha ".to_owned()]
        );
    }
}
