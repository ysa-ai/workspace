-- Migrate post-execution steps to readonly
UPDATE workflow_steps SET tool_preset = 'readonly', container_mode = 'readonly'
  WHERE tool_preset = 'post-execution';

-- Remove post-execution builtin preset
DELETE FROM tool_presets WHERE name = 'post-execution' AND is_builtin = true;

-- Simplify readonly and readwrite presets (empty = all tools, no capability names)
UPDATE tool_presets SET tools = '' WHERE name = 'readonly' AND is_builtin = true;
UPDATE tool_presets SET tools = '' WHERE name = 'readwrite' AND is_builtin = true;
