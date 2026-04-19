-- Fix rollback_configuration INSERT: PL/pgSQL record cannot be used as FROM source.
CREATE OR REPLACE FUNCTION rollback_configuration(
  p_config_key TEXT,
  p_to_version INT,
  p_operator_id TEXT,
  p_scope_type policy_config_scope_type DEFAULT 'global',
  p_scope_value TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_rollback_id TEXT;
  v_now TIMESTAMPTZ := now();
  v_target_record RECORD;
BEGIN
  SELECT * INTO v_target_record
  FROM policy_configurations
  WHERE config_key = p_config_key
    AND entity_version = p_to_version
    AND scope_type = p_scope_type
    AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target version % not found for key % in scope %/%',
      p_to_version, p_config_key, p_scope_type, p_scope_value;
  END IF;

  UPDATE policy_configurations
  SET is_active = false,
      updated_at = v_now,
      updated_by = p_operator_id
  WHERE config_key = p_config_key
    AND scope_type = p_scope_type
    AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    AND entity_version > p_to_version
    AND is_active = true;

  v_rollback_id := gen_random_uuid()::text;

  INSERT INTO policy_configurations (
    id,
    config_key,
    config_value,
    is_sensitive,
    entity_version,
    created_at,
    updated_at,
    updated_by,
    scope_type,
    scope_value,
    is_active
  )
  VALUES (
    v_rollback_id,
    p_config_key,
    v_target_record.config_value,
    v_target_record.is_sensitive,
    (
      SELECT COALESCE(MAX(entity_version), 0) + 1
      FROM policy_configurations
      WHERE config_key = p_config_key
        AND scope_type = p_scope_type
        AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    ),
    v_now,
    v_now,
    p_operator_id,
    p_scope_type,
    p_scope_value,
    true
  );

  RETURN v_rollback_id;
END;
$$ LANGUAGE plpgsql;
