import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');

export const CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME = 'conai_helper';
export const CONAI_HELPER_CUSTOM_NODE_PACKAGE_FILENAME = 'conai-helper-comfyui-custom-node.zip';

const EMBEDDED_CONAI_HELPER_FILES: Record<string, string> = {
  "__init__.py": "import os\nimport re\nimport shutil\nfrom datetime import datetime\nfrom pathlib import Path\n\nimport folder_paths\n\n\n_SAFE_NAME_PATTERN = re.compile(r'[<>:\"/\\\\|?*\\x00-\\x1F]')\n\n\ndef _safe_file_name(value: str, fallback: str = \"artifact.bin\") -> str:\n    name = _SAFE_NAME_PATTERN.sub(\"_\", os.path.basename(value.strip()))\n    return name or fallback\n\n\ndef _safe_relative_subfolder(value: str) -> str:\n    normalized = value.strip().replace(\"\\\\\", \"/\").strip(\"/\")\n    parts = []\n    for part in normalized.split(\"/\"):\n        if not part or part in {\".\", \"..\"}:\n            continue\n        parts.append(_SAFE_NAME_PATTERN.sub(\"_\", part))\n    return \"/\".join(parts)\n\n\ndef _available_target_path(directory: Path, file_name: str, overwrite: bool) -> Path:\n    target = directory / file_name\n    if overwrite or not target.exists():\n        return target\n\n    stem = target.stem\n    suffix = target.suffix\n    counter = 2\n    while True:\n        candidate = directory / f\"{stem}-{counter}{suffix}\"\n        if not candidate.exists():\n            return candidate\n        counter += 1\n\n\ndef _available_target_directory(target: Path, overwrite: bool) -> Path:\n    if overwrite:\n        if target.is_dir():\n            shutil.rmtree(target)\n        elif target.exists():\n            target.unlink()\n        return target\n\n    if not target.exists():\n        return target\n\n    counter = 2\n    while True:\n        candidate = target.parent / f\"{target.name}-{counter}\"\n        if not candidate.exists():\n            return candidate\n        counter += 1\n\n\ndef _iter_files(root: Path):\n    for child in sorted(root.iterdir(), key=lambda path: path.name.lower()):\n        if child.is_dir():\n            yield from _iter_files(child)\n        elif child.is_file():\n            yield child\n\n\ndef _is_within(root: Path, candidate: Path) -> bool:\n    return os.path.commonpath([str(root), str(candidate)]) == str(root)\n\n\ndef _timestamp_prefix() -> str:\n    return datetime.now().strftime(\"%Y-%m-%d_%H-%M-%S-%f\")[:-3]\n\n\ndef _history_file_entries(output_root: Path, root: Path):\n    entries = []\n    for file_path in _iter_files(root):\n        entries.append({\n            \"filename\": file_path.name,\n            \"subfolder\": file_path.parent.relative_to(output_root).as_posix(),\n            \"type\": \"output\",\n        })\n    return entries\n\n\nclass CoNAIArtifactFileOutput:\n    \"\"\"Copy a file or its parent folder into ComfyUI output for CoNAI artifact collection.\"\"\"\n\n    @classmethod\n    def INPUT_TYPES(cls):\n        return {\n            \"required\": {\n                \"file_path\": (\"STRING\", {\"default\": \"\", \"multiline\": False, \"forceInput\": True}),\n                \"subfolder\": (\"STRING\", {\"default\": \"conai_artifacts\", \"multiline\": False}),\n                \"filename_override\": (\"STRING\", {\"default\": \"\", \"multiline\": False}),\n                \"copy_parent_folder\": (\"BOOLEAN\", {\"default\": True}),\n                \"overwrite\": (\"BOOLEAN\", {\"default\": False}),\n            }\n        }\n\n    RETURN_TYPES = ()\n    FUNCTION = \"copy_file\"\n    OUTPUT_NODE = True\n    CATEGORY = \"CoNAI Helper/artifacts\"\n    DESCRIPTION = \"Copies a file or parent folder into ComfyUI output so CoNAI can collect it as an artifact.\"\n\n    def copy_file(\n        self,\n        file_path: str,\n        subfolder: str = \"conai_artifacts\",\n        filename_override: str = \"\",\n        copy_parent_folder: bool = True,\n        overwrite: bool = False,\n    ):\n        raw_path = str(file_path or \"\").strip().strip('\"')\n        if not raw_path:\n            raise ValueError(\"CoNAI Helper Artifact Output requires file_path.\")\n\n        source_path = Path(raw_path).expanduser().resolve()\n        if not source_path.exists() or not source_path.is_file():\n            raise FileNotFoundError(f\"Artifact source file not found: {source_path}\")\n\n        output_root = Path(folder_paths.get_output_directory()).resolve()\n        safe_subfolder = _safe_relative_subfolder(str(subfolder or \"conai_artifacts\"))\n        target_parent = (output_root / safe_subfolder).resolve()\n        if not _is_within(output_root, target_parent):\n            raise ValueError(\"Artifact subfolder escapes ComfyUI output directory.\")\n        target_parent.mkdir(parents=True, exist_ok=True)\n\n        if copy_parent_folder:\n            source_root = source_path.parent\n            base_name = _safe_file_name(filename_override.strip() if filename_override else source_root.name, source_root.name)\n            target_name = f\"{_timestamp_prefix()}_{base_name}\"\n            target_root = _available_target_directory((target_parent / target_name).resolve(), bool(overwrite))\n            if not _is_within(output_root, target_root):\n                raise ValueError(\"Artifact target escapes ComfyUI output directory.\")\n            shutil.copytree(str(source_root), str(target_root))\n            return {\"ui\": {\"files\": _history_file_entries(output_root, target_root)}}\n\n        target_name = _safe_file_name(filename_override.strip() if filename_override else source_path.name, source_path.name)\n        target_path = _available_target_path(target_parent, target_name, bool(overwrite)).resolve()\n        if not _is_within(output_root, target_path):\n            raise ValueError(\"Artifact target escapes ComfyUI output directory.\")\n        shutil.copy2(str(source_path), str(target_path))\n        return {\n            \"ui\": {\n                \"files\": [{\n                    \"filename\": target_path.name,\n                    \"subfolder\": target_path.parent.relative_to(output_root).as_posix(),\n                    \"type\": \"output\",\n                }]\n            }\n        }\n\n\nNODE_CLASS_MAPPINGS = {\n    \"CoNAIArtifactFileOutput\": CoNAIArtifactFileOutput,\n}\n\nNODE_DISPLAY_NAME_MAPPINGS = {\n    \"CoNAIArtifactFileOutput\": \"CoNAI Helper: Artifact Output\",\n}\n\n\n",
  "README.md": "# CoNAI Helper for ComfyUI\n\nComfyUI\uc5d0\uc11c \uc0dd\uc131\ub41c \ud30c\uc77c\uc774\ub098 \ud3f4\ub354 \ub2e8\uc704 \uacb0\uacfc\ubb3c\uc744 CoNAI \uc544\ud2f0\ud329\ud2b8\ub85c \ub118\uae30\uae30 \uc704\ud55c \ucee4\uc2a4\ud140 \ub178\ub4dc\uc785\ub2c8\ub2e4.\n\n## \uc124\uce58\n\n1. \uc774 \ud3f4\ub354\ub97c ComfyUI\uc758 `custom_nodes` \uc544\ub798\uc5d0 \ubcf5\uc0ac\ud569\ub2c8\ub2e4.\n   - \uc608: `ComfyUI/custom_nodes/conai_helper`\n2. ComfyUI\ub97c \uc7ac\uc2dc\uc791\ud569\ub2c8\ub2e4.\n3. \ub178\ub4dc \uac80\uc0c9\uc5d0\uc11c `CoNAI Helper: Artifact Output`\uc744 \ucc3e\uc2b5\ub2c8\ub2e4.\n\n## \ub178\ub4dc\n\n### `CoNAI Helper: Artifact Output`\n\n- \ub0b4\ubd80 class key: `CoNAIArtifactFileOutput`\n- category: `CoNAI Helper/artifacts`\n- \uae30\uc874 workflow \ud638\ud658\uc744 \uc704\ud574 \ub0b4\ubd80 class key\ub294 \uc720\uc9c0\ud569\ub2c8\ub2e4.\n\n## \uc785\ub825\n\n- `file_path`: CoNAI\ub85c \ub118\uae38 \ud30c\uc77c \uacbd\ub85c\n- `subfolder`: ComfyUI output \uc544\ub798 \uc800\uc7a5 \ud3f4\ub354. \uae30\ubcf8\uac12 `conai_artifacts`\n- `filename_override`: \uc800\uc7a5 \uc774\ub984 override. \ube44\uc6b0\uba74 \uc6d0\ubcf8 \uc774\ub984 \uc0ac\uc6a9\n- `copy_parent_folder`: \ucf1c\uba74 `file_path`\uc758 \ubd80\ubaa8 \ud3f4\ub354 \uc804\uccb4 \ubcf5\uc0ac\n- `overwrite`: \ucf1c\uba74 \ub3d9\uc77c \ub300\uc0c1 \ub36e\uc5b4\uc4f0\uae30 \ud5c8\uc6a9\n\n## \ub3d9\uc791\n\n\ub178\ub4dc\ub294 \uc120\ud0dd\ud55c \ud30c\uc77c \ub610\ub294 \ubd80\ubaa8 \ud3f4\ub354\ub97c ComfyUI output \ud3f4\ub354 \uc544\ub798\ub85c \ubcf5\uc0ac\ud558\uace0, ComfyUI history\uc5d0 output file entry\ub85c \ub4f1\ub85d\ud569\ub2c8\ub2e4. CoNAI\ub294 \ud574\ub2f9 history entry\ub97c \ud1b5\ud574 \uacb0\uacfc \ud30c\uc77c\uc744 \uc544\ud2f0\ud329\ud2b8\ub85c \uc218\uc9d1\ud569\ub2c8\ub2e4.\n\n## \uc8fc\uc758\n\n- `file_path`\ub294 \uc2e4\uc81c \uc874\uc7ac\ud558\ub294 \ud30c\uc77c\uc774\uc5b4\uc57c \ud569\ub2c8\ub2e4.\n- `subfolder`\ub294 ComfyUI output \ud3f4\ub354 \ubc16\uc73c\ub85c \ub098\uac08 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.\n- `copy_parent_folder`\ub97c \ucf1c\uba74 \ubd80\ubaa8 \ud3f4\ub354 \uc804\uccb4\uac00 \ubcf5\uc0ac\ub418\ubbc0\ub85c \uc6a9\ub7c9\uc744 \ud655\uc778\ud558\uc138\uc694.\n\n"
};

function getResourceDirCandidates() {
  return [
    path.resolve(process.cwd(), 'resources', 'comfyui-custom-nodes', CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME),
    path.resolve(process.cwd(), '..', 'resources', 'comfyui-custom-nodes', CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME),
    path.resolve(__dirname, '..', '..', 'resources', 'comfyui-custom-nodes', CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME),
    path.resolve(__dirname, '..', '..', '..', 'resources', 'comfyui-custom-nodes', CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME),
  ];
}

function readResourceFiles() {
  for (const candidate of getResourceDirCandidates()) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      continue;
    }

    const files: Record<string, string> = {};
    for (const fileName of Object.keys(EMBEDDED_CONAI_HELPER_FILES)) {
      const filePath = path.join(candidate, fileName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        break;
      }
      files[fileName] = fs.readFileSync(filePath, 'utf8');
    }

    if (Object.keys(files).length === Object.keys(EMBEDDED_CONAI_HELPER_FILES).length) {
      return files;
    }
  }

  return EMBEDDED_CONAI_HELPER_FILES;
}

export function buildConaiHelperCustomNodeArchive() {
  const zip = new AdmZip();
  const files = readResourceFiles();

  for (const [fileName, content] of Object.entries(files)) {
    zip.addFile(`${CONAI_HELPER_CUSTOM_NODE_FOLDER_NAME}/${fileName}`, Buffer.from(content, 'utf8'));
  }

  return zip.toBuffer();
}
