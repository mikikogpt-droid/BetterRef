export function parseArgs(argv) {
  const values = {};
  const flags = new Set();

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected argument: ${item}`);
    }

    const [rawKey, inlineValue] = item.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) {
      throw new Error(`Invalid argument: ${item}`);
    }

    if (inlineValue !== undefined) {
      addValue(values, key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }

    addValue(values, key, next);
    i += 1;
  }

  return { values, flags };
}

function addValue(values, key, value) {
  if (values[key] === undefined) {
    values[key] = value;
    return;
  }

  if (Array.isArray(values[key])) {
    values[key].push(value);
    return;
  }

  values[key] = [values[key], value];
}

export function pick(values, ...keys) {
  for (const key of keys) {
    if (values[key] !== undefined) {
      return values[key];
    }
  }
  return undefined;
}

export function numberValue(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return parsed;
}
