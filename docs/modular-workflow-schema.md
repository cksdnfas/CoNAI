# Modular Workflow Schema Draft

## Core idea
Different authoring flows compile into one runtime module shape.

- NAI authoring: current generation page state -> snapshot -> expose selected fields
- ComfyUI authoring: existing workflow + marked_fields -> wrap -> expose selected fields/outputs

## Core tables

### module_definitions
Represents a reusable runtime module.

Key fields:
- `engine_type`: `nai` | `comfyui`
- `authoring_source`: `nai_form_snapshot` | `comfyui_workflow_wrap` | `manual`
- `template_defaults`: full stored engine payload/template
- `exposed_inputs`: runtime-editable input ports
- `output_ports`: downstream-connectable output ports
- `internal_fixed_values`: values fixed by module author
- `ui_schema`: optional inspector/form hints

### graph_workflows
A saved node-edge graph document.

### graph_workflow_versions
Version snapshots for saved graph workflows.

### graph_executions
Future runtime execution records.

### graph_execution_artifacts
Future intermediate outputs (image/mask/text/json/file).

## Port model
A port has:
- `key`
- `label`
- `direction`
- `data_type`
- `required`
- `multiple`
- `default_value`
- `source_path`

## Runtime graph model
Each node stores:
- `id`
- `module_id`
- `position`
- `input_values`

Each edge stores:
- `source_node_id`
- `source_port_key`
- `target_node_id`
- `target_port_key`

## Practical rule
Authoring UX can differ per engine.
Runtime module shape must stay shared.
