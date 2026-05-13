import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BetterRef3DError } from './threeD.mjs';

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

async function readJson(filePath, label) {
  if (!filePath) throw new BetterRef3DError(`Missing ${label} path.`);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRef3DError(`Could not read ${label} JSON at ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
}

async function nonEmptyFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function resolveProjectPath(filePath, projectDir) {
  if (!filePath) return null;
  return path.isAbsolute(String(filePath)) ? String(filePath) : path.resolve(projectDir || process.cwd(), String(filePath));
}

function projectRelative(filePath, projectDir) {
  if (!filePath || !projectDir) return filePath;
  const resolved = path.resolve(filePath);
  const relative = path.relative(path.resolve(projectDir), resolved);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, '/');
  }
  return filePath;
}

function firstModelResultFile(asset) {
  const files = asArray(asset?.source?.resultFiles);
  return files.find((file) => /\.(?:glb|gltf|fbx|obj)(?:$|[?#])/i.test(String(file?.url || file?.path || file || ''))) || files[0];
}

function resultFileLocation(file) {
  if (!file) return null;
  if (typeof file === 'string') return file;
  return file.path || file.url || file.Url || file.uri || file.href || null;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function extensionFromSource(value, fallback = '.glb') {
  const clean = String(value || '').split(/[?#]/)[0];
  const ext = path.extname(clean);
  return ext || fallback;
}

async function downloadOrCopySource({ source, outDir, assetId }) {
  const location = resultFileLocation(source);
  if (!location) {
    throw new BetterRef3DError(`3D asset ${assetId} has no source model result file.`);
  }

  if (!isHttpUrl(location)) {
    const resolved = resolveProjectPath(location);
    if (!(await nonEmptyFile(resolved))) {
      throw new BetterRef3DError(`3D asset ${assetId} source model is missing or empty: ${location}`);
    }
    return resolved;
  }

  const response = await fetch(location);
  if (!response.ok) {
    throw new BetterRef3DError(`Could not download 3D asset ${assetId} from ${location}: HTTP ${response.status}`, 1);
  }
  const rawDir = path.join(outDir, 'raw');
  await mkdir(rawDir, { recursive: true });
  const target = path.join(rawDir, `${assetId}${extensionFromSource(location)}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

function blenderExecutable(value) {
  return value || process.env.BLENDER_PATH || 'blender';
}

function blenderAvailable(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function renderBlenderScript() {
  return String.raw`import argparse
import json
import math
import os
import sys

import bpy


def parse_args():
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--betterref-output", required=True)
    parser.add_argument("--turntable-dir", required=True)
    parser.add_argument("--max-triangles", type=int, default=0)
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_model(file_path):
    lower = file_path.lower()
    if lower.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=file_path)
    elif lower.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=file_path)
    elif lower.endswith(".obj"):
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=file_path)
        else:
            bpy.ops.import_scene.obj(filepath=file_path)
    else:
        raise RuntimeError(f"Unsupported model format: {file_path}")


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def stats_for(objects):
    vertices = sum(len(obj.data.vertices) for obj in objects)
    faces = sum(len(obj.data.polygons) for obj in objects)
    triangles = sum(sum(max(len(poly.vertices) - 2, 1) for poly in obj.data.polygons) for obj in objects)
    return {"vertexCount": vertices, "faceCount": faces, "triangleCount": triangles}


def clean_meshes(objects):
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        except Exception:
            pass
        try:
            bpy.ops.object.shade_smooth()
        except Exception:
            pass
        obj.select_set(False)


def decimate_to_budget(objects, max_triangles, before_triangles):
    if max_triangles <= 0 or before_triangles <= max_triangles:
        return False
    ratio = max(min(max_triangles / max(before_triangles, 1), 1.0), 0.02)
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new("BetterRef Roblox Budget Decimate", "DECIMATE")
        modifier.ratio = ratio
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except Exception:
            pass
        obj.select_set(False)
    return True


def setup_camera(objects):
    bpy.ops.object.light_add(type="AREA", location=(2.5, -3.5, 4.0))
    light = bpy.context.object
    light.name = "BetterRef Key Light"
    light.data.energy = 450
    light.data.size = 4
    bpy.ops.object.camera_add(location=(0, -4, 2.2), rotation=(math.radians(62), 0, 0))
    bpy.context.scene.camera = bpy.context.object
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"


def render_turntable(asset_id, objects, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    setup_camera(objects)
    renders = []
    for index, angle in enumerate([0, 120, 240]):
        for obj in objects:
            obj.rotation_euler[2] = math.radians(angle)
        path = os.path.join(output_dir, f"{asset_id}-turntable-{index + 1}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        renders.append(path)
    return renders


def material_evidence(objects):
    materials = []
    textures = []
    for obj in objects:
        for slot in obj.material_slots:
            if slot.material:
                materials.append(slot.material.name)
                for node in getattr(slot.material.node_tree, "nodes", []):
                    image = getattr(node, "image", None)
                    if image:
                        textures.append(image.filepath or image.name)
    return sorted(set(materials)), sorted(set(textures))


def main():
    args = parse_args()
    clear_scene()
    import_model(args.input)
    objects = mesh_objects()
    if not objects:
        raise RuntimeError("No mesh objects were imported.")
    before = stats_for(objects)
    clean_meshes(objects)
    decimated = decimate_to_budget(objects, args.max_triangles, before["triangleCount"])
    after = stats_for(objects)
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB")
    renders = render_turntable(args.asset_id, objects, args.turntable_dir)
    materials, textures = material_evidence(objects)
    os.makedirs(os.path.dirname(args.betterref_output), exist_ok=True)
    with open(args.betterref_output, "w", encoding="utf8") as handle:
        json.dump({
            "schemaVersion": "betterref.blender.refine.result.v1",
            "assetId": args.asset_id,
            "sourceModelPath": args.input,
            "modelPath": args.output,
            "beforeMeshStats": before,
            "meshStats": after,
            "decimated": decimated,
            "maxTriangles": args.max_triangles,
            "renders": renders,
            "materials": materials,
            "textures": textures
        }, handle, indent=2)


if __name__ == "__main__":
    main()
`;
}

function buildBlenderCommand({ blender, scriptPath, asset, sourceModelPath, targetModelPath, outputJsonPath, turntableDir }) {
  return [
    blender,
    '-b',
    '--python',
    scriptPath,
    '--',
    '--asset-id',
    asset.id,
    '--input',
    sourceModelPath,
    '--output',
    targetModelPath,
    '--betterref-output',
    outputJsonPath,
    '--turntable-dir',
    turntableDir,
    '--max-triangles',
    String(asset.triangleBudget?.maxTriangles || 0)
  ];
}

function evidenceAssetFromBlender({ asset, blenderResult, projectDir, scriptPath, command }) {
  const modelPath = projectRelative(blenderResult.modelPath, projectDir);
  const renders = asArray(blenderResult.renders).map((item) => projectRelative(item, projectDir));
  const textures = asArray(blenderResult.textures).map((item) => projectRelative(item, projectDir));
  return {
    id: asset.id,
    status: 'completed',
    modelPath,
    meshStats: blenderResult.meshStats,
    renders,
    materialEvidence: {
      materials: asArray(blenderResult.materials),
      textureMaps: textures
    },
    refinementEvidence: {
      tool: 'blender',
      automation: 'betterref-auto-refine',
      optimized: true,
      decimate: Boolean(blenderResult.decimated),
      maxTriangles: asset.triangleBudget?.maxTriangles || null,
      beforeMeshStats: blenderResult.beforeMeshStats,
      finalModelPath: modelPath,
      scriptPath,
      command: command.join(' ')
    }
  };
}

function mergeEvidence(existing, newAssets) {
  const assets = asArray(existing?.assets);
  for (const asset of newAssets) {
    const index = assets.findIndex((item) => item.id === asset.id || item.assetId === asset.id);
    if (index === -1) {
      assets.push(asset);
    } else {
      assets[index] = { ...assets[index], ...asset };
    }
  }
  return {
    ...existing,
    schemaVersion: 'betterref.3d.evidence.v1',
    generatedAt: new Date().toISOString(),
    assets
  };
}

function nextActionsText(result) {
  return `# BetterRef Auto Refine Next Actions

Status: ${result.status}

Blender was not available, so BetterRef wrote the automation script and planned commands instead of editing the model.

Run one command per asset after installing Blender or pass \`--blender <path>\`:

${result.assets.map((asset) => `\`\`\`bash\n${asset.command.join(' ')}\n\`\`\``).join('\n\n')}
`;
}

export async function autoRefine3D({
  refinePlanPath,
  outDir,
  projectDir,
  evidencePath,
  blenderPath,
  dryRun = false
} = {}) {
  if (!outDir) throw new BetterRef3DError('Missing required --out for auto-refine.');
  const refinePlan = await readJson(refinePlanPath, '3D refine plan');
  const resolvedProjectDir = projectDir || refinePlan.projectDir || process.cwd();
  const scriptPath = path.join(outDir, 'blender', 'betterref-auto-refine.py');
  const evidenceOutPath = evidencePath || path.join(outDir, '3d-evidence.json');
  const commandOutPath = path.join(outDir, 'auto-refine-commands.json');
  const resultPath = path.join(outDir, 'auto-refine-result.json');
  const nextActionsPath = path.join(outDir, 'auto-refine-next-actions.md');
  await writeText(scriptPath, renderBlenderScript());

  const blender = blenderExecutable(blenderPath);
  const canRun = !dryRun && blenderAvailable(blender);
  const assets = [];
  const evidenceAssets = [];

  for (const asset of asArray(refinePlan.assets)) {
    const sourceFile = firstModelResultFile(asset);
    const sourceLocation = resultFileLocation(sourceFile);
    const sourceModelPath = dryRun || !canRun
      ? resolveProjectPath(sourceLocation, resolvedProjectDir)
      : await downloadOrCopySource({ source: sourceFile, outDir, assetId: asset.id });
    const targetModelPath = resolveProjectPath(asset.targetPath || path.join('public', 'betterref-assets', `${asset.id}.glb`), resolvedProjectDir);
    const turntableDir = path.join(outDir, 'turntable', asset.id);
    const blenderJsonPath = path.join(outDir, 'blender', `${asset.id}-result.json`);
    const command = buildBlenderCommand({
      blender,
      scriptPath,
      asset,
      sourceModelPath,
      targetModelPath,
      outputJsonPath: blenderJsonPath,
      turntableDir
    });
    const plannedAsset = {
      id: asset.id,
      sourceModelPath,
      targetModelPath,
      triangleBudget: asset.triangleBudget || null,
      command,
      ranBlender: false
    };

    if (canRun) {
      await mkdir(path.dirname(targetModelPath), { recursive: true });
      const spawned = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
      if (spawned.error || spawned.status !== 0) {
        throw new BetterRef3DError(
          `Blender auto-refine failed for ${asset.id}: ${spawned.error?.message || spawned.stderr || `exit ${spawned.status}`}`,
          1
        );
      }
      const blenderResult = await readJson(blenderJsonPath, 'Blender auto-refine result');
      plannedAsset.ranBlender = true;
      plannedAsset.blenderResultPath = blenderJsonPath;
      evidenceAssets.push(evidenceAssetFromBlender({ asset, blenderResult, projectDir: resolvedProjectDir, scriptPath, command }));
    }

    assets.push(plannedAsset);
  }

  if (canRun && evidenceAssets.length > 0) {
    const existing = evidencePath && (await nonEmptyFile(evidencePath)) ? await readJson(evidencePath, '3D evidence') : {};
    await writeJson(evidenceOutPath, mergeEvidence(existing, evidenceAssets));
  }

  const result = {
    schemaVersion: 'betterref.3d.auto_refine.result.v1',
    generatedAt: new Date().toISOString(),
    status: dryRun ? 'planned' : canRun ? 'completed' : 'blocked',
    dryRun: Boolean(dryRun),
    blender,
    assets,
    artifacts: {
      blenderScriptPath: scriptPath,
      commandsPath: commandOutPath,
      evidencePath: evidenceOutPath,
      resultPath,
      nextActionsPath: canRun ? null : nextActionsPath
    }
  };
  await writeJson(commandOutPath, { schemaVersion: 'betterref.3d.auto_refine.commands.v1', assets });
  if (!canRun) {
    await writeText(nextActionsPath, nextActionsText(result));
  }
  await writeJson(resultPath, result);
  return result;
}

function contentTypeForModel(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === '.fbx') return 'model/fbx';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.rbxm') return 'model/x-rbxm';
  if (ext === '.rbxmx') return 'model/x-rbxmx';
  return 'application/octet-stream';
}

function multipartBody({ request, filePath, contentType }) {
  const boundary = `betterref-${randomBytes(8).toString('hex')}`;
  return readFile(filePath).then((fileBuffer) => {
    const filename = path.basename(filePath).replace(/"/g, '');
    const chunks = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n${JSON.stringify(request)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileContent"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    return {
      body: Buffer.concat(chunks),
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  });
}

function operationIdFromCreateResponse(value) {
  const raw = value?.path || value?.name || value?.operationId || value?.id || value?.operation?.path || value?.operation?.name;
  if (!raw) return null;
  return String(raw).replace(/^.*operations\//, '');
}

function assetIdFromOperation(value) {
  return String(
    value?.response?.assetId ||
      value?.response?.asset?.assetId ||
      value?.response?.asset?.id ||
      value?.assetId ||
      value?.asset?.assetId ||
      ''
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new BetterRef3DError(`Roblox Open Cloud request failed: HTTP ${response.status} ${text}`, 1);
  }
  return body;
}

function findEvidenceAsset(evidence, assetId) {
  const assets = asArray(evidence.assets);
  if (assetId) return assets.find((item) => item.id === assetId || item.assetId === assetId);
  return assets[0];
}

function creatorContext({ creatorUserId, creatorGroupId }) {
  if (creatorUserId) return { userId: String(creatorUserId) };
  if (creatorGroupId) return { groupId: String(creatorGroupId) };
  throw new BetterRef3DError('Missing --creator-user-id or --creator-group-id for Roblox upload.');
}

export async function uploadRobloxAsset({
  evidencePath,
  outDir,
  projectDir,
  assetId,
  modelPath,
  apiKey,
  apiBase = 'https://apis.roblox.com',
  creatorUserId,
  creatorGroupId,
  displayName,
  description,
  pollIntervalMs = 1000,
  pollAttempts = 30,
  dryRun = false
} = {}) {
  if (!outDir) throw new BetterRef3DError('Missing required --out for Roblox upload.');
  const evidence = await readJson(evidencePath, '3D evidence');
  const item = findEvidenceAsset(evidence, assetId);
  if (!item) throw new BetterRef3DError(`Could not find 3D evidence asset ${assetId || '(first asset)'}.`);
  const resolvedModelPath = resolveProjectPath(modelPath || item.modelPath || item.generatedPath || item.outputPath, projectDir);
  if (!(await nonEmptyFile(resolvedModelPath))) {
    throw new BetterRef3DError(`Roblox upload model file is missing or empty: ${resolvedModelPath}`);
  }

  const requestPath = path.join(outDir, 'roblox-upload-request.json');
  const resultPath = path.join(outDir, 'roblox-upload-result.json');
  const request = {
    assetType: 'Model',
    displayName: displayName || item.id || assetId || path.basename(resolvedModelPath, path.extname(resolvedModelPath)),
    description: description || 'Uploaded by BetterRef automated 3D production.',
    creationContext: {
      creator: creatorContext({ creatorUserId, creatorGroupId })
    }
  };
  await writeJson(requestPath, {
    schemaVersion: 'betterref.roblox.upload.request.v1',
    generatedAt: new Date().toISOString(),
    apiBase,
    request,
    modelPath: projectRelative(resolvedModelPath, projectDir),
    contentType: contentTypeForModel(resolvedModelPath)
  });

  if (dryRun) {
    const planned = {
      schemaVersion: 'betterref.roblox.upload.result.v1',
      generatedAt: new Date().toISOString(),
      status: 'planned',
      assetId: item.id || assetId || null,
      roblox: null,
      artifacts: { requestPath, resultPath, evidencePath }
    };
    await writeJson(resultPath, planned);
    return planned;
  }

  const key = apiKey || process.env.ROBLOX_OPEN_CLOUD_API_KEY;
  if (!key) throw new BetterRef3DError('Missing --roblox-api-key or ROBLOX_OPEN_CLOUD_API_KEY.');
  const { body, contentType } = await multipartBody({
    request,
    filePath: resolvedModelPath,
    contentType: contentTypeForModel(resolvedModelPath)
  });
  const createResponse = await fetchJson(`${apiBase.replace(/\/$/, '')}/assets/v1/assets`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'content-type': contentType,
      connection: 'close'
    },
    body
  });
  const operationId = operationIdFromCreateResponse(createResponse);
  if (!operationId) throw new BetterRef3DError('Roblox Open Cloud create response did not include an operation id.', 1);

  let operation = null;
  for (let attempt = 0; attempt < Number(pollAttempts); attempt += 1) {
    operation = await fetchJson(`${apiBase.replace(/\/$/, '')}/assets/v1/operations/${encodeURIComponent(operationId)}`, {
      headers: { 'x-api-key': key, connection: 'close' }
    });
    if (operation.done === true || String(operation.status || '').toLowerCase() === 'completed') break;
    if (attempt < Number(pollAttempts) - 1 && Number(pollIntervalMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(pollIntervalMs)));
    }
  }
  if (!operation || (operation.done !== true && String(operation.status || '').toLowerCase() !== 'completed')) {
    throw new BetterRef3DError(`Roblox Open Cloud operation ${operationId} did not complete.`, 1);
  }
  const robloxAssetId = assetIdFromOperation(operation);
  if (!robloxAssetId) throw new BetterRef3DError(`Roblox Open Cloud operation ${operationId} completed without an asset id.`, 1);

  const evidenceAsset = findEvidenceAsset(evidence, item.id || assetId);
  evidenceAsset.robloxImportEvidence = {
    method: 'open-cloud-assets-api',
    imported: true,
    uploaded: true,
    assetType: 'Model',
    assetId: robloxAssetId,
    operationId,
    sourceModelPath: projectRelative(resolvedModelPath, projectDir),
    uploadedAt: new Date().toISOString()
  };
  await writeJson(evidencePath, evidence);

  const result = {
    schemaVersion: 'betterref.roblox.upload.result.v1',
    generatedAt: new Date().toISOString(),
    status: 'completed',
    assetId: evidenceAsset.id || assetId || null,
    roblox: {
      assetId: robloxAssetId,
      operationId,
      createResponse,
      operation
    },
    artifacts: { requestPath, resultPath, evidencePath }
  };
  await writeJson(resultPath, result);
  return result;
}
