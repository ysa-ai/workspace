INSERT INTO workflows (name, description, is_builtin, org_id) VALUES ('Plan & Execute', 'Plan then execute with change report', true, NULL) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO workflow_steps (workflow_id, name, slug, position, prompt_template, tool_preset, container_mode, modules, auto_advance) SELECT id, 'Plan', 'plan', 1, '', 'readonly', 'readonly', '[{"name":"plan","prompt":""}]', false FROM workflows WHERE name = 'Plan & Execute' AND is_builtin = true LIMIT 1 ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO workflow_steps (workflow_id, name, slug, position, prompt_template, tool_preset, container_mode, modules, auto_advance) SELECT id, 'Execute', 'execute', 2, '', 'default', 'readwrite', '[{"name":"unit_tests","prompt":""},{"name":"change_report","prompt":""}]', false FROM workflows WHERE name = 'Plan & Execute' AND is_builtin = true LIMIT 1 ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO workflow_transitions (from_step_id, to_step_id, label, is_default, position) SELECT ws_plan.id, ws_exec.id, 'Approve', true, 0 FROM workflow_steps ws_plan JOIN workflow_steps ws_exec ON ws_exec.slug = 'execute' AND ws_exec.workflow_id = ws_plan.workflow_id JOIN workflows w ON w.id = ws_plan.workflow_id WHERE ws_plan.slug = 'plan' AND w.name = 'Plan & Execute' AND w.is_builtin = true LIMIT 1 ON CONFLICT DO NOTHING;
