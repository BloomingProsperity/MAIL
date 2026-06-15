CREATE TABLE IF NOT EXISTS domain_destinations (
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (domain_id, destination_id)
);

CREATE INDEX IF NOT EXISTS domain_destinations_destination_idx
  ON domain_destinations (destination_id, domain_id);
