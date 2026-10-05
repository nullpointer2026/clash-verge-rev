use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::HashSet;

pub(super) fn apply_deleted_nodes(mut config: Mapping, names: &[String], providers_deleted: &[String]) -> Mapping {
    if names.is_empty() && providers_deleted.is_empty() {
        return config;
    }
    let deleted: HashSet<&str> = names.iter().map(String::as_str).collect();
    if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
        proxies.retain(|proxy| {
            !proxy
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| deleted.contains(name))
        });
    }

    let exact_names = names
        .iter()
        .map(|name| regex::escape(name).replace('`', "\\x{60}"))
        .collect::<Vec<_>>()
        .join("|");
    let pattern = format!("^({exact_names})$");
    if let Some(Value::Mapping(providers)) = config.get_mut("proxy-providers") {
        for (name, provider) in providers.iter_mut() {
            let Some(provider) = provider.as_mapping_mut() else {
                continue;
            };
            if name
                .as_str()
                .is_some_and(|name| providers_deleted.iter().any(|deleted| deleted.as_str() == name))
            {
                *provider = Mapping::new();
                provider.insert(Value::from("type"), Value::from("inline"));
                let mut direct = Mapping::new();
                direct.insert(Value::from("name"), Value::from("DIRECT"));
                direct.insert(Value::from("type"), Value::from("direct"));
                provider.insert(Value::from("payload"), Value::Sequence(vec![Value::Mapping(direct)]));
                continue;
            }
            let prefix = provider
                .get("override")
                .and_then(|value| value.get("additional-prefix"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let suffix = provider
                .get("override")
                .and_then(|value| value.get("additional-suffix"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            // Provider filters run before name overrides; groups see the final names.
            let raw_names = names
                .iter()
                .filter_map(|name| {
                    let name = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
                    Some(regex::escape(name).replace('`', "\\x{60}"))
                })
                .collect::<Vec<_>>()
                .join("|");
            if !raw_names.is_empty() {
                add_exclusion(provider, &format!("^({raw_names})$"));
            }
        }
    }

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups.iter_mut().filter_map(Value::as_mapping_mut) {
            add_exclusion(group, &pattern);
            group
                .entry(Value::from("empty-fallback"))
                .or_insert_with(|| Value::from("DIRECT"));
            if let Some(Value::Sequence(proxies)) = group.get_mut("proxies") {
                proxies.retain(|proxy| !proxy.as_str().is_some_and(|name| deleted.contains(name)));
            }
            let has_proxies = group
                .get("proxies")
                .and_then(Value::as_sequence)
                .is_some_and(|items| !items.is_empty());
            let has_providers = group
                .get("use")
                .and_then(Value::as_sequence)
                .is_some_and(|items| !items.is_empty());
            let includes_all = ["include-all", "include-all-proxies", "include-all-providers"]
                .iter()
                .any(|key| group.get(*key).and_then(Value::as_bool).unwrap_or(false));
            if !has_proxies && !has_providers && !includes_all {
                group.insert(Value::from("proxies"), Value::Sequence(vec![Value::from("DIRECT")]));
            }
        }
    }
    let mut value = Value::Mapping(config);
    repair_references(&mut value, &deleted);
    match value {
        Value::Mapping(config) => config,
        _ => unreachable!(),
    }
}

fn add_exclusion(mapping: &mut Mapping, pattern: &str) {
    let filter = match mapping.get("exclude-filter").and_then(Value::as_str) {
        Some(existing) if !existing.is_empty() => existing
            .split("```")
            .map(|part| format!("({part})|{pattern}"))
            .collect::<Vec<_>>()
            .join("```"),
        _ => pattern.to_owned(),
    };
    mapping.insert(Value::from("exclude-filter"), Value::from(filter));
}

fn repair_references(value: &mut Value, deleted: &HashSet<&str>) {
    match value {
        Value::Mapping(map) => {
            for (key, value) in map.iter_mut() {
                if matches!(key.as_str(), Some("dialer-proxy" | "proxy" | "empty-fallback"))
                    && value.as_str().is_some_and(|name| deleted.contains(name))
                {
                    *value = Value::from("DIRECT");
                } else if key.as_str() == Some("rules") {
                    repair_rules(value, deleted);
                } else if key.as_str() == Some("sub-rules") {
                    if let Some(sub_rules) = value.as_mapping_mut() {
                        for rules in sub_rules.values_mut() {
                            repair_rules(rules, deleted);
                        }
                    }
                } else {
                    repair_references(value, deleted);
                }
            }
        }
        Value::Sequence(items) => {
            for item in items {
                repair_references(item, deleted);
            }
        }
        _ => {}
    }
}

fn repair_rules(value: &mut Value, deleted: &HashSet<&str>) {
    let Some(rules) = value.as_sequence_mut() else {
        return;
    };
    for rule in rules {
        let Some(text) = rule.as_str() else {
            continue;
        };
        let mut fields: Vec<&str> = text.split(',').collect();
        let target = if fields.last().is_some_and(|field| field.trim() == "no-resolve") {
            fields.len().checked_sub(2)
        } else {
            fields.len().checked_sub(1)
        };
        if let Some(target) = target
            && deleted.contains(fields[target].trim())
        {
            fields[target] = "DIRECT";
            *rule = Value::from(fields.join(","));
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn deletion_repairs_groups_rules_and_dialers_without_changing_source() {
        let source: Mapping = serde_yaml_ng::from_str(
            "proxies:\n  - {name: A, type: ss}\n  - {name: B, type: ss, dialer-proxy: A}\nproxy-groups:\n  - {name: Select, type: select, proxies: [A]}\nrules: [DOMAIN, 'IP-CIDR,1.0.0.0/8,A,no-resolve', 'MATCH,A']",
        ).expect("parse source");
        let result = apply_deleted_nodes(source.clone(), &["A".into()], &[]);
        assert_eq!(source["proxies"].as_sequence().expect("source proxies").len(), 2);
        assert_eq!(result["proxies"].as_sequence().expect("proxies").len(), 1);
        assert_eq!(result["proxies"][0]["dialer-proxy"], "DIRECT");
        assert_eq!(result["proxy-groups"][0]["proxies"][0], "DIRECT");
        assert_eq!(result["proxy-groups"][0]["empty-fallback"], "DIRECT");
        assert_eq!(result["rules"][1], "IP-CIDR,1.0.0.0/8,DIRECT,no-resolve");
        assert_eq!(result["rules"][2], "MATCH,DIRECT");
        assert_eq!(apply_deleted_nodes(source.clone(), &[], &[]), source);
    }

    #[test]
    fn provider_filter_preserves_existing_filter_and_matches_exact_names() {
        let source: Mapping = serde_yaml_ng::from_str(
            "proxy-providers:\n  P: {type: inline, exclude-filter: old, payload: []}\nproxy-groups:\n  - {name: Select, type: select, use: [P]}",
        ).expect("parse provider");
        let result = apply_deleted_nodes(source, &["A.+[1]".into(), "```".into()], &[]);
        let filter = result["proxy-providers"]["P"]["exclude-filter"]
            .as_str()
            .expect("filter");
        let patterns: Vec<_> = filter.split("```").collect();
        assert_eq!(patterns.len(), 1);
        let exact = regex::Regex::new(patterns[0]).expect("exact regex");
        assert!(exact.is_match("old"));
        assert!(exact.is_match("A.+[1]"));
        assert!(exact.is_match("```"));
        assert!(!exact.is_match("A.+[1] backup"));
        assert_eq!(result["proxy-groups"][0]["use"][0], "P");
    }

    #[test]
    fn an_emptied_provider_remains_valid_with_a_direct_fallback() {
        let source: Mapping = serde_yaml_ng::from_str(
            "proxy-providers:\n  P: {type: http, url: 'https://example.test/nodes', path: './nodes.yaml'}\nproxy-groups:\n  - {name: Select, type: select, use: [P]}",
        ).expect("parse provider");
        let result = apply_deleted_nodes(source, &["A".into()], &["P".into()]);
        assert_eq!(result["proxy-providers"]["P"]["type"], "inline");
        assert_eq!(result["proxy-providers"]["P"]["payload"][0]["type"], "direct");
        assert_eq!(result["proxy-groups"][0]["use"][0], "P");
    }

    #[test]
    fn displayed_names_do_not_delete_other_prefixed_provider_nodes() {
        let source: Mapping = serde_yaml_ng::from_str(
            "proxy-providers:\n  P: {type: inline, override: {additional-prefix: 'P '}, payload: []}\n  Q: {type: inline, override: {additional-prefix: 'Q '}, payload: []}",
        ).expect("parse providers");
        let result = apply_deleted_nodes(source, &["P A".into()], &[]);
        assert_eq!(result["proxy-providers"]["P"]["exclude-filter"], "^(A)$");
        assert!(result["proxy-providers"]["Q"].get("exclude-filter").is_none());
    }
}
