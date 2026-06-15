CREATE UNIQUE INDEX IF NOT EXISTS routing_rules_domain_catch_all_uidx
  ON routing_rules (domain_id, rule_type)
  WHERE rule_type = 'catch_all';

CREATE INDEX IF NOT EXISTS aliases_domain_enabled_idx
  ON aliases (domain_id, enabled, local_part);

CREATE INDEX IF NOT EXISTS delivery_logs_domain_created_idx
  ON delivery_logs (domain_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS alias_routes_destination_idx
  ON alias_routes (destination_id, alias_id);
