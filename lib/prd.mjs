import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

export class BetterRefPrdError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefPrdError';
  }
}

const AGENTS_BEGIN_MARKER = '<!-- BEGIN BETTERREF AGENTS CONTRACT -->';
const AGENTS_END_MARKER = '<!-- END BETTERREF AGENTS CONTRACT -->';
const DEFAULT_SKILL_PATHS = {
  usingSuperpowers: 'C:\\Users\\Miki\\.codex\\skills\\using-superpowers\\SKILL.md',
  karpathyGuidelines: 'C:\\Users\\Miki\\.codex\\skills\\karpathy-guidelines\\SKILL.md',
  betterref: 'C:\\Users\\Miki\\.codex\\skills\\betterref\\SKILL.md'
};

const WINDOWS_1252_BYTE_BY_CODEPOINT = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

const THAI_PDF_TEXT_REPLACEMENTS = [
  ['ประสบกำรณ์', 'ประสบการณ์'],
  ['ผู้ใช้งำน', 'ผู้ใช้งาน'],
  ['สำมำรถ', 'สามารถ'],
  ['วินำที', 'วินาที'],
  ['รำงวัล', 'รางวัล'],
  ['บริกำร', 'บริการ'],
  ['ลูกค้ำ', 'ลูกค้า'],
  ['สร้ำง', 'สร้าง'],
  ['ผ่ำน', 'ผ่าน'],
  ['หน้ำ', 'หน้า'],
  ['ต่ำง', 'ต่าง'],
  ['ง่ำย', 'ง่าย'],
  ['จ่ำย', 'จ่าย'],
  ['ข้ำง', 'ข้าง'],
  ['เข้ำ', 'เข้า'],
  ['ใช้งำน', 'ใช้งาน'],
  ['ควำม', 'ความ'],
  ['รำคำ', 'ราคา'],
  ['รำย', 'ราย'],
  ['สำย', 'สาย'],
  ['ตำม', 'ตาม'],
  ['มำตร', 'มาตร'],
  ['กำร', 'การ'],
  ['จำก', 'จาก'],
  ['ภำพ', 'ภาพ'],
  ['เบำ', 'เบา'],
  ['พำ', 'พา'],
  ['มำ', 'มา']
];

function byteFromThaiMojibakeThirdChar(char) {
  const codePoint = char.codePointAt(0);
  if (WINDOWS_1252_BYTE_BY_CODEPOINT.has(codePoint)) {
    return WINDOWS_1252_BYTE_BY_CODEPOINT.get(codePoint);
  }
  if (codePoint >= 0x0e01 && codePoint <= 0x0e5b) {
    return codePoint - 0x0e00 + 0xa0;
  }
  if (codePoint <= 0xff) {
    return codePoint;
  }
  return null;
}

function repairThaiUtf8Mojibake(text) {
  let output = '';
  let pendingBytes = [];
  const flushPendingBytes = () => {
    if (pendingBytes.length === 0) {
      return;
    }
    output += Buffer.from(pendingBytes).toString('utf8');
    pendingBytes = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0e40 && index + 2 < text.length) {
      const second = text.charCodeAt(index + 1);
      const third = byteFromThaiMojibakeThirdChar(text[index + 2]);
      if ((second === 0x0e18 || second === 0x0e19) && third >= 0x80 && third <= 0xbf) {
        pendingBytes.push(0xe0, second === 0x0e18 ? 0xb8 : 0xb9, third);
        index += 2;
        continue;
      }
    }
    flushPendingBytes();
    output += text[index];
  }
  flushPendingBytes();
  return output;
}

function normalizeThaiPdfArtifacts(text) {
  let normalized = text.replace(/;([่้๊๋]?ำ)/g, '$1');
  for (const [from, to] of THAI_PDF_TEXT_REPLACEMENTS) {
    normalized = normalized.replaceAll(from, to);
  }
  return normalized;
}

export function normalizeExtractedPrdText(text) {
  return normalizeThaiPdfArtifacts(repairThaiUtf8Mojibake(String(text || '')));
}

async function extractPdfText(pdfPath) {
  let parser;
  try {
    const data = await readFile(pdfPath);
    parser = new PDFParse({ data });
    const result = await parser.getText();
    return {
      text: normalizeExtractedPrdText(result.text || ''),
      pageCount: result.total || result.pages?.length || null
    };
  } catch (error) {
    throw new BetterRefPrdError(`Could not extract PRD PDF text from ${pdfPath}: ${error.message}`);
  } finally {
    await parser?.destroy?.();
  }
}

function defaultReferenceImageNames(screens) {
  const fallback = [
    'home-dashboard-ref',
    'topup-catalog-ref',
    'reward-games-ref',
    'events-dashboard-ref',
    'inventory-vault-ref',
    'transaction-history-ref',
    'help-center-ref'
  ];
  const screenNames = Array.isArray(screens)
    ? screens.map((screen) => `${slug(screen || 'reference')}-ref`)
    : [];
  return [...fallback, ...screenNames];
}

async function extractPdfReferenceImages({ pdfPath, outDir, projectDir, screens }) {
  const referenceDir = projectDir
    ? path.join(path.resolve(projectDir), '.betterref-references')
    : path.join(outDir, 'references');
  const manifestPath = path.join(referenceDir, 'manifest.json');
  let parser;
  try {
    await mkdir(referenceDir, { recursive: true });
    const data = await readFile(pdfPath);
    parser = new PDFParse({ data });
    const result = await parser.getImage({
      imageBuffer: true,
      imageDataUrl: false,
      imageThreshold: 300
    });
    const names = defaultReferenceImageNames(screens);
    const references = [];
    const maxReferences = Math.max(7, Math.min(12, Array.isArray(screens) ? screens.length : 7));

    for (const page of result.pages || []) {
      for (const image of page.images || []) {
        const width = Number(image.width || 0);
        const height = Number(image.height || 0);
        if (!image.data || width < 900 || height < 500) {
          continue;
        }
        const index = references.length;
        const baseName = names[index] || `reference-${String(index + 1).padStart(2, '0')}`;
        const filePath = path.join(referenceDir, `${baseName}.png`);
        await writeFile(filePath, Buffer.from(image.data));
        references.push({
          file: filePath,
          sourcePdf: pdfPath,
          sourcePage: page.pageNumber,
          sourceImageName: image.name,
          nativeSize: { width, height },
          role: 'reference evidence only, not shipped UI'
        });
        if (references.length >= maxReferences) {
          await writeFile(manifestPath, `${JSON.stringify(references, null, 2)}\n`);
          return { referenceDir, manifestPath, references };
        }
      }
    }

    await writeFile(manifestPath, `${JSON.stringify(references, null, 2)}\n`);
    return { referenceDir, manifestPath, references };
  } catch (error) {
    const warning = `Could not extract embedded PRD reference images: ${error.message}`;
    await mkdir(referenceDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({ warning, references: [] }, null, 2)}\n`);
    return { referenceDir, manifestPath, references: [], warning };
  } finally {
    await parser?.destroy?.();
  }
}

function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitItems(value) {
  return String(value)
    .split(/[,;•|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findAfterLabel(text, label) {
  const pattern = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i');
  return pattern.exec(text)?.[1]?.trim() || '';
}

function dimensionPairs(value) {
  return [...String(value || '').matchAll(/(\d{3,5})\s*x\s*(\d{3,5})/gi)].map((match) => ({
    width: Number(match[1]),
    height: Number(match[2])
  }));
}

function isReferenceOnlyViewportLine(value) {
  return /reference\s*(?:diff|crop|image|evidence)|pdf\s*crop|embedded\s+prd\s+reference|evidence\s+only|not\s+production\s+viewport/i.test(
    String(value || '')
  );
}

function parseViewport(text, fallback) {
  if (fallback) {
    const [viewport] = dimensionPairs(fallback);
    if (viewport) {
      return { ...viewport, source: 'override' };
    }
  }

  const sourceLines = lines(text);
  const preferredPatterns = [
    /primary\s+desktop\s+(?:target|viewport)/i,
    /production\s+desktop\s+(?:target|viewport)/i,
    /desktop\s+design\s+(?:target|viewport)/i,
    /design\s+viewport/i,
    /target\s+viewport/i,
    /viewport\s+contract/i
  ];
  for (const pattern of preferredPatterns) {
    const line = sourceLines.find((item) => pattern.test(item) && !isReferenceOnlyViewportLine(item));
    const [viewport] = dimensionPairs(line);
    if (viewport) {
      return { ...viewport, source: 'prd' };
    }
  }

  const viewportLine = sourceLines.find((line) => /\bviewport\b/i.test(line) && !isReferenceOnlyViewportLine(line));
  const [viewport] = dimensionPairs(viewportLine || findAfterLabel(text, 'viewport'));
  if (viewport) {
    return { ...viewport, source: 'prd' };
  }

  return { width: 1440, height: 900, source: 'default' };
}

function parseReferenceDiffViewport(text) {
  const line = lines(text).find((item) => /reference\s*(?:diff|crop|image|evidence)|pdf\s*crop/i.test(item));
  const [viewport] = dimensionPairs(line);
  return viewport ? { ...viewport, role: 'reference_diff_evidence_only' } : null;
}

function parseAdditionalDesktopViewports(text, primaryViewport) {
  const result = [];
  for (const line of lines(text)) {
    if (!/additional\s+desktop|desktop\s+evidence|responsive\s+desktop/i.test(line)) {
      continue;
    }
    for (const viewport of dimensionPairs(line)) {
      if (viewport.width === primaryViewport.width && viewport.height === primaryViewport.height) {
        continue;
      }
      result.push(viewport);
    }
  }
  return uniqueViewports(result);
}

function parseMobileViewport(text) {
  const line = lines(text).find((item) => /\bmobile\b/i.test(item) && /\bviewport|evidence\b/i.test(item));
  const [viewport] = dimensionPairs(line);
  return viewport || null;
}

function uniqueViewports(viewports) {
  const seen = new Set();
  const result = [];
  for (const viewport of viewports) {
    const key = `${viewport.width}x${viewport.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(viewport);
  }
  return result;
}

function parseThresholds(text) {
  const thresholds = {};
  const specs = [
    ['minSsim', /min\s*ssim|minSsim/gi],
    ['maxChangedPercent', /max\s*changed\s*percent|maxChangedPercent/gi],
    ['maxMeanDiff', /max\s*mean\s*diff|maxMeanDiff/gi]
  ];

  for (const [name, labelPattern] of specs) {
    const label = labelPattern.source.replaceAll('\\s*', '\\s*');
    const match = new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)`, 'i').exec(text);
    if (match) {
      thresholds[name] = Number(match[1]);
    }
  }

  return Object.keys(thresholds).length > 0
    ? thresholds
    : { maxChangedPercent: 16, maxMeanDiff: 4, minSsim: 0.98 };
}

function parseScreens(text) {
  const labeled = findAfterLabel(text, 'required screens') || findAfterLabel(text, 'screens');
  if (labeled) {
    return splitItems(labeled);
  }
  const sourceLines = lines(text);
  const canonicalScreens = [
    ['Homepage', /\b(?:home\s?page|homepage|landing)\b|หน้าแรก/i],
    ['Catalog', /\b(?:catalog|all games|game list|games page)\b|เกมทั้งหมด/i],
    ['Checkout', /\b(?:checkout|top-up flow|payment flow|order flow)\b|ชำระ|จ่าย/i],
    ['Promotions', /\b(?:promotions?|rewards?|campaigns?)\b|โปรโมชัน|รางวัล/i],
    ['Account Dashboard', /\b(?:account dashboard|dashboard|profile|recent orders|saved ids|favorites)\b|ติดตามออเดอร์/i],
    ['Admin Orders', /\badmin\b.*\border|\border\b.*\badmin\b/i]
  ]
    .filter(([, pattern]) => sourceLines.some((line) => pattern.test(line)))
    .map(([name]) => name);
  if (canonicalScreens.length > 0) {
    return unique(canonicalScreens).slice(0, 8);
  }
  return sourceLines
    .filter((line) => /screen|page|flow|landing|admin|checkout|order/i.test(line))
    .slice(0, 8);
}

function parseRequirements(text) {
  const result = [];
  for (const label of ['summary', 'visual requirements', 'requirements', 'acceptance criteria']) {
    const value = findAfterLabel(text, label);
    if (value) {
      result.push(...splitItems(value));
    }
  }
  result.push(
    ...lines(text).filter((line) =>
      /must|should|required|requirement|visual|font|layout|responsive|mobile|desktop|asset|image|hero|mascot|raster|3d|glb|gltf|obj|usdz|mesh|topology|turntable|model-viewer|three\.?js|hunyuan|hugging\s*face|glass|cinematic|premium|texture|background|illustration|rendered|banner|overlap|clip|animated|animation|motion|reveal|intro|loop|webm|mp4|video|hyperframes|gsap/i.test(line)
    )
  );
  return unique(result).filter((item) => !isRequirementHeadingNoise(item)).slice(0, 40);
}

function isRequirementHeadingNoise(item) {
  const value = item.replace(/\s+/g, ' ').trim();
  return [
    /^(?:section|component|area|feature|requirement)\s+requirements?$/i,
    /^(?:requirement|details|requirement details|page purpose core modules)$/i,
    /^\d+(?:\.\d+)*\.?\s+.*(?:requirements?|copy|extracted)$/i,
    /^\d+(?:\.\d+)*\.?\s*(?:functional|visual|homepage|catalog|checkout|promotions?|account dashboard)\s+requirements?$/i
  ].some((pattern) => pattern.test(value));
}

function parseHardFails(text) {
  const hardFailText = findAfterLabel(text, 'hard fail') || findAfterLabel(text, 'hard fails');
  const result = hardFailText ? splitItems(hardFailText) : [];
  result.push(
    ...lines(text)
      .filter((line) => /hard fail|no overlap|overflow|clip|not clip|must not|ห้าม|ทับ|ล้น/i.test(line))
      .map((line) => line.replace(/^hard fails?\s*[:\-]\s*/i, ''))
  );
  return unique(result).slice(0, 20);
}

function inferLongReference(text) {
  const source = String(text || '');
  if (/single[-\s]?viewport|single\s+screen|long[-\s]?page\s*(?:reference|mode)?\s*[:=]\s*(?:false|no)/i.test(source)) {
    return false;
  }
  return /(?:full[-\s]?page|long[-\s]?page)\s*(?:scroll\s*)?(?:reference|screenshot|capture|mode)\s*[:=]\s*(?:true|yes)|reference\s*type\s*[:=]\s*(?:full[-\s]?page|long[-\s]?page|whole\s+page|entire\s+page)/i.test(
    source
  );
}

function inferAssetQualityRequired(text, requirements = []) {
  const source = `${text}\n${requirements.join('\n')}`;
  return /hero|mascot|asset|image|raster|3d|glb|gltf|obj|usdz|mesh|topology|turntable|model-viewer|three\.?js|hunyuan|hugging\s*face|glass|cinematic|premium|texture|background|illustration|rendered|animated|animation|motion|reveal|intro|loop|webm|mp4|video|hyperframes/i.test(source);
}

function inferHyperframesRequired(requirements = []) {
  return requirements.some(isHyperframesAssetRequirement);
}

function inferThreeDRequired(requirements = []) {
  return requirements.some(isThreeDModelRequirement);
}

function inferHunyuanRequired(requirements = []) {
  return requirements.some((item) => isThreeDModelRequirement(item) && isHunyuanProviderRequirement(item));
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const normalized = item.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function classifyRequirement(item) {
  if (/hard fail|overlap|overflow|clip|must not|no horizontal/i.test(item)) {
    return 'hard-fail';
  }
  if (/mobile|desktop|responsive|viewport|breakpoint/i.test(item)) {
    return 'responsive';
  }
  if (isCodeNativeVisualBehavior(item) || isCodeNativeUiRequirement(item) || /button|form|flow|auth|payment|search|filter|navigation|click|interactive/i.test(item)) {
    return 'behavior';
  }
  if (/copy|label|price|pricing|game|promotion|badge|legal|content/i.test(item)) {
    return 'content';
  }
  if (isGeneratedAssetRequirement(item)) {
    return 'asset';
  }
  return 'visual';
}

function isCodeNativeVisualBehavior(item) {
  const value = item.toLowerCase();
  const assetOverride = /(?:\b3d\s+asset\b|\basset rules\b|cinematic|mascot|character|background\s+texture|hero\s+(?:image|visual|asset|art|frame)|banner\s+(?:image|art|asset)|game\s+(?:image|art|asset)|wallet\s+(?:image|art|asset)|ภาพ.*(?:เกม|การ์ด|แบนเนอร์)|ฮีโร่|พื้นหลัง)/i;
  if (assetOverride.test(item)) {
    return false;
  }
  if (/\b(?:animated|animation|motion|reveal|intro|loop|webm|mp4|video|hyperframes|gsap)\b/i.test(item) && /\b(?:hero|logo|background|scene|asset|visual|banner)\b/i.test(item)) {
    return false;
  }
  if (/\b(sticky|hover|zoom|parallax|particle|performance|hamburger|scroll)\b/i.test(item)) {
    return true;
  }
  if (/\b(?:mobile|desktop|responsive|breakpoint)\b/i.test(item) && !/\b(?:hero|image|asset|3d|mascot|background)\b/i.test(item)) {
    return true;
  }
  if (/\bfallback\b/i.test(item)) {
    return true;
  }
  return /(?:หลัง\s*scroll|ลด\s*parallax|fallback\s*เป็น\s*static)/i.test(value);
}

function isCodeNativeUiRequirement(item) {
  const value = String(item || '');
  const uiSubject = /\b(?:ui|text|copy|label|labels|button|buttons|cta|navigation|nav|overlay|overlays|form|forms|input|field|menu|control|controls)\b/i;
  const codeNativeIntent = /\b(?:remain|remains|keep|keeps|stay|stays|code-native|react\/css|react|css|not\s+(?:model\s+)?geometry|not\s+baked|not\s+part\s+of\s+(?:the\s+)?model)\b/i;
  return uiSubject.test(value) && codeNativeIntent.test(value);
}

function isHyperframesAssetRequirement(item) {
  if (isCodeNativeVisualBehavior(item)) {
    return false;
  }
  const value = String(item || '');
  const subject = /\b(?:hero|logo|brand|emblem|background|scene|intro|loop|asset|visual|banner|product|game|mascot|character)\b/i;
  const motion = /\b(?:animated|animation|motion|reveal|intro|loop|webm|mp4|video|cinematic\s+loop|glow\s+pulse|shader|transition|audio-reactive|hyperframes|gsap)\b/i;
  return subject.test(value) && motion.test(value);
}

function hasStrongThreeDModelCue(item) {
  const value = String(item || '');
  return [
    /\b3d\s+model\b/i,
    /\breal\s+3d\b/i,
    /\b(?:glb|gltf|obj|usdz)\b/i,
    /\b(?:mesh|topology|turntable|model-viewer)\b/i,
    /\bhunyuan\s*3d\b/i
  ].some((pattern) => pattern.test(value));
}

function isHunyuanProviderRequirement(item) {
  const value = String(item || '');
  return /\b(?:hunyuan(?:\s*3d)?|tencent(?:\s*cloud)?(?:\s+hunyuan3d)?|tencent\/hunyuan3d)\b/i.test(value);
}

function isThreeDAcceptanceOnlyRequirement(item) {
  const value = String(item || '');
  const acceptanceCue = /\b(?:3d\s+)?(?:acceptance|criteria|evidence|verification|quality gate)\b/i.test(value) ||
    /\b(?:mesh stats?|vertex|vertices|triangles?|turntable|multi-angle|must load|runtime-load)\b/i.test(value);
  const modelCreationCue = /\b(?:generate|create|make|build|produce|asset|mascot|character|product|object|vehicle|prop|model\s+asset|3d\s+model|glb\s+model|hunyuan)\b/i.test(value);
  return acceptanceCue && !modelCreationCue;
}

function isThreeDModelRequirement(item) {
  if (isCodeNativeVisualBehavior(item)) {
    return false;
  }
  if (isThreeDAcceptanceOnlyRequirement(item)) {
    return false;
  }
  const value = String(item || '');
  const hasStrongCue = hasStrongThreeDModelCue(value);
  if (isCodeNativeUiRequirement(item) && !hasStrongCue) {
    return false;
  }
  return hasStrongCue ||
    (/\bthree\.?js\b/i.test(value) && /\b(?:3d|model|mesh|glb|gltf|obj|usdz|hunyuan|turntable)\b/i.test(value));
}

function isGeneratedAssetRequirement(item) {
  if (isCodeNativeVisualBehavior(item)) {
    return false;
  }
  if (/\bmodules?\s*:/i.test(item) && !/\basset\b/i.test(item)) {
    return false;
  }
  if (isHyperframesAssetRequirement(item)) {
    return true;
  }
  const visualSubject = /\b(?:hero|logo|emblem|frame|mascot|character|background|texture|illustration|image|banner|card|asset|art|icon)\b|ภาพ.*(?:เกม|wallet|การ์ด|แบนเนอร์)|ฮีโร่|พื้นหลัง|มาสคอต/i;
  const richQualifier = /\b(?:3d|glass|cinematic|premium|raster|rendered|neon)\b/i;
  if (visualSubject.test(item) && richQualifier.test(item)) {
    return true;
  }
  return [
    /\bhero\s*3d\b/i,
    /\b3d\s+asset\b|\basset rules\b/i,
    /\b(?:background|texture|illustration|mascot|character)\b/i,
    /\b(?:hero|banner)\s+(?:visual|asset|image|art|frame)\b/i,
    /\b(?:game|wallet|promo|promotion|banner)\s+(?:image|art|asset)\b/i,
    /\bimage\b.*\b(?:game|wallet|card|banner|promo|promotion)\b/i,
    /\b(?:logo|icon)\b/i,
    /ภาพ.*(?:เกม|wallet|การ์ด|แบนเนอร์)|ฮีโร่|พื้นหลัง|มาสคอต/i
  ].some((pattern) => pattern.test(item));
}

function phaseForRequirement(item) {
  const value = item.toLowerCase();
  const phases = [
    ['header-hero', /header|nav|navbar|hero|landing|banner|mascot/],
    ['quick-topup', /top up|top-up|เติม|package|card/],
    ['popular-games', /popular|game|games|grid|เกม/],
    ['promotions', /promotion|promo|news|update|discount|โปรโมชัน|ข่าว/],
    ['trust-payment', /security|ssl|payment|bank|wallet|trust|ปลอดภัย|ชำระ/],
    ['footer', /footer|bottom|ท้าย/]
  ];
  return phases.find(([, pattern]) => pattern.test(value))?.[0] || 'global';
}

function slug(value) {
  return String(value || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function assetRoleForRequirement(item) {
  const value = item.toLowerCase();
  if (isHyperframesAssetRequirement(item)) {
    return 'animated-cinematic-hero';
  }
  if (/\b(?:hero|landing|banner)\b|ฮีโร่/.test(value) && /\b(?:3d|logo|frame|status|card|cards|premium|glass|cinematic)\b/.test(value)) {
    return 'cinematic-hero';
  }
  if (/logo|brand/.test(value)) {
    return 'brand-logo';
  }
  if (/icon/.test(value)) {
    return 'icon-set';
  }
  if (/background|texture/.test(value)) {
    return 'background-texture';
  }
  if (/mascot|character/.test(value)) {
    return 'hero-mascot';
  }
  if (/\b(?:game|wallet|card|banner|promo|promotion)\b/.test(value)) {
    return 'game-card-art';
  }
  if (/hero|3d|glass|cinematic|premium|rendered/.test(value)) {
    return 'cinematic-hero';
  }
  return 'raster-asset';
}

function makeAssetPrompt({ requirement, role, viewport }) {
  return [
    `Create a production-ready ONETAPGG ${role} asset for a ${viewportString(viewport)} web UI.`,
    `Requirement: ${requirement}`,
    'Style: premium gaming, neon purple and electric blue accents, sharp glass/3D depth, clean transparent or web-ready composition.',
    'Do not include browser chrome, UI text blocks, screenshots, PDF renders, watermarks, or reference-image borders.',
    'Leave room for code-native UI text and controls to be layered separately.'
  ].join(' ');
}

function referenceEvidenceFor(referenceImages, preferredNames = []) {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return [];
  }
  const normalizedPreferred = preferredNames.map((item) => String(item || '').toLowerCase()).filter(Boolean);
  const named = referenceImages
    .filter((reference) => {
      if (normalizedPreferred.length === 0) {
        return true;
      }
      const fileName = path.basename(reference.file || '').toLowerCase();
      return normalizedPreferred.some((name) => fileName.includes(name));
    })
    .map((reference) => ({
      file: reference.file,
      nativeSize: reference.nativeSize,
      role: reference.role || 'reference evidence only, not shipped UI'
    }));
  return named.length > 0 ? named : referenceImages.slice(0, 2).map((reference) => ({
    file: reference.file,
    nativeSize: reference.nativeSize,
    role: reference.role || 'reference evidence only, not shipped UI'
  }));
}

function referenceBackedAssetSpecs({ requirements = [], screens = [], referenceImages = [], viewport }) {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return [];
  }
  const corpus = `${requirements.join('\n')}\n${screens.join('\n')}`;
  if (!/ONETAPGG|gaming|dashboard|top.?up|reward|event|promotion|หน้า|เติม|เกม|รางวัล|กิจกรรม/i.test(corpus)) {
    return [];
  }

  const homeEvidence = referenceEvidenceFor(referenceImages, ['home-dashboard']);
  const catalogEvidence = referenceEvidenceFor(referenceImages, ['topup-catalog']);
  const rewardEvidence = referenceEvidenceFor(referenceImages, ['reward-games', 'home-dashboard']);
  const eventEvidence = referenceEvidenceFor(referenceImages, ['events-dashboard', 'home-dashboard']);
  const sharedCriteria = [
    'Do not use PRD/PDF/reference crop or screenshot as the asset.',
    'Use an official/local production asset first when one exists; otherwise generate this exact slot with image_gen.',
    'This asset must be unique to its slot and must not be reused as a generic filler for other cards.',
    'Native asset dimensions must be at least the rendered browser size.',
    'Mark status pass only after the asset is attached, wired into the actual app, and visible in fresh browser evidence.'
  ];
  const makeSpec = ({
    role,
    phase,
    targetPath,
    requirement,
    prompt,
    minNativeWidth,
    minNativeHeight,
    referenceEvidence
  }) => ({
    status: 'pending',
    phase,
    role,
    requirement,
    tool: 'image_gen',
    implementation: 'official-or-local-production-asset-preferred-imagegen-fallback',
    targetPath,
    minNativeWidth,
    minNativeHeight,
    minSharpness: 20,
    prompt: [
      `Create the ONETAPGG ${role} production asset for a ${viewportString(viewport)} implementation.`,
      prompt,
      'Use the extracted PRD reference images only as composition/style evidence, never as source pixels or a pasted UI.',
      'Do not include browser chrome, UI text blocks, screenshots, PDF renders, watermarks, or reference-image borders.'
    ].join(' '),
    referenceEvidence,
    acceptanceCriteria: sharedCriteria
  });

  const specs = [
    makeSpec({
      role: 'brand-logo',
      phase: 'header-hero',
      targetPath: 'public/betterref-assets/brand-logo.png',
      requirement: 'Reference-backed asset: ONETAPGG sidebar/topbar 3D neon brand logo, transparent PNG.',
      prompt: 'Design a crisp glossy purple/electric-blue ONETAPGG emblem/logo suitable for the left sidebar brand tile and compact account identity. Transparent background, square-safe composition, strong 3D depth, no baked navigation or labels.',
      minNativeWidth: 1024,
      minNativeHeight: 1024,
      referenceEvidence: homeEvidence
    }),
    makeSpec({
      role: 'hero-emblem',
      phase: 'header-hero',
      targetPath: 'public/betterref-assets/hero-emblem.png',
      requirement: 'Reference-backed asset: large 3D ONETAPGG hero emblem/headphone mark for homepage hero.',
      prompt: 'Create a large glossy futuristic G-shaped gaming emblem with headphone-like side details, purple neon highlights, cyan rim lighting, black glass depth, and transparent/web-ready edges for the homepage hero.',
      minNativeWidth: Math.max(viewport.width, 1920),
      minNativeHeight: Math.max(Math.round(viewport.height * 0.7), 900),
      referenceEvidence: homeEvidence
    }),
    makeSpec({
      role: 'hero-background',
      phase: 'header-hero',
      targetPath: 'public/betterref-assets/hero-background.png',
      requirement: 'Reference-backed asset: cyber neon city/data-grid hero background texture.',
      prompt: 'Create a wide dark cyber dashboard background with blue/purple city silhouettes, digital grid floor, floating neon cubes, and a central glow stage. Leave clean negative space for code-native headline and buttons.',
      minNativeWidth: Math.max(viewport.width * 2, 3840),
      minNativeHeight: Math.max(viewport.height, 1080),
      referenceEvidence: homeEvidence
    }),
    makeSpec({
      role: 'sidebar-user-avatar',
      phase: 'header-hero',
      targetPath: 'public/betterref-assets/sidebar-user-avatar.png',
      requirement: 'Reference-backed asset: compact ONETAPGG user/avatar medallion for sidebar account card.',
      prompt: 'Create a small circular gamer account medallion with ONETAPGG purple/cyan neon styling, readable at sidebar scale, transparent background, no real person, no UI text.',
      minNativeWidth: 512,
      minNativeHeight: 512,
      referenceEvidence: homeEvidence
    })
  ];

  const gameCovers = [
    ['game-cover-01', 'anime titan action game cover with intense close-up face, warm gold/brown energy, card-safe crop'],
    ['game-cover-02', 'icy fantasy survival game cover with blue crystal energy, sharp motion, card-safe crop'],
    ['game-cover-03', 'tactical battle royale soldier cover with helmet and teal sky, card-safe crop'],
    ['game-cover-04', 'abstract red orb promo game cover with simple bold focal point, card-safe crop'],
    ['game-cover-05', 'anime reward character cover with red/white accent and close-up face, card-safe crop'],
    ['game-cover-06', 'fantasy character portrait cover with light hair and blue/purple neon edge, card-safe crop']
  ];
  for (const [name, description] of gameCovers) {
    specs.push(makeSpec({
      role: 'game-cover',
      phase: 'popular-games',
      targetPath: `public/betterref-assets/${name}.png`,
      requirement: `Reference-backed asset: unique homepage game card cover ${name}.`,
      prompt: `Create a unique premium vertical game cover: ${description}. Avoid third-party logos and exact copyrighted game marks unless the project supplies official licensed assets.`,
      minNativeWidth: 900,
      minNativeHeight: 1200,
      referenceEvidence: catalogEvidence
    }));
  }

  const recommendations = [
    ['recommendation-cover-01', 'compact fantasy RPG warrior recommendation cover with warm character lighting'],
    ['recommendation-cover-02', 'compact icy action survival recommendation cover with blue energy slash'],
    ['recommendation-cover-03', 'compact tactical mobile battle royale recommendation cover with soldier silhouette']
  ];
  for (const [name, description] of recommendations) {
    specs.push(makeSpec({
      role: 'recommendation-cover',
      phase: 'popular-games',
      targetPath: `public/betterref-assets/${name}.png`,
      requirement: `Reference-backed asset: right-panel recommendation cover ${name}.`,
      prompt: `Create a unique small landscape recommendation thumbnail: ${description}. Must remain sharp at small sidebar-panel size.`,
      minNativeWidth: 900,
      minNativeHeight: 520,
      referenceEvidence: homeEvidence
    }));
  }

  const rewards = [
    ['reward-card-01', 'neon reward wheel with tokens, star coin, and blue/purple roulette glow'],
    ['reward-card-02', 'mystery cyber crate with question mark glow and digital particles'],
    ['reward-card-03', 'purple reward tickets/cards flying outward with premium energy trails']
  ];
  for (const [name, description] of rewards) {
    specs.push(makeSpec({
      role: 'reward-card',
      phase: 'promotions',
      targetPath: `public/betterref-assets/${name}.png`,
      requirement: `Reference-backed asset: homepage reward card background ${name}.`,
      prompt: `Create a wide reward card background: ${description}. Leave room for code-native title and button overlays.`,
      minNativeWidth: 1400,
      minNativeHeight: 620,
      referenceEvidence: rewardEvidence
    }));
  }

  const events = [
    ['event-card-01', 'splash festival cyber mage scene with blue water energy and purple character lighting'],
    ['event-card-02', 'gold ticket and coins campaign scene with violet digital background'],
    ['event-card-03', 'mystery vault/chest event scene with purple gift icons and crystalline glow'],
    ['event-card-04', 'green cyber mission event with futuristic character silhouette and neon particles'],
    ['event-card-05', 'top spender trophy/prize event with gold star coin and purple reward burst']
  ];
  for (const [name, description] of events) {
    specs.push(makeSpec({
      role: 'event-card',
      phase: 'promotions',
      targetPath: `public/betterref-assets/${name}.png`,
      requirement: `Reference-backed asset: events rail card background ${name}.`,
      prompt: `Create a wide event card background: ${description}. Keep text-free and leave a dark overlay-safe area for code-native labels.`,
      minNativeWidth: 1400,
      minNativeHeight: 520,
      referenceEvidence: eventEvidence
    }));
  }

  return specs;
}

function makeHyperframesPrompt({ requirement, role, viewport }) {
  return [
    `Create a HyperFrames ${role} composition for a ${viewportString(viewport)} ONETAPGG web UI asset.`,
    `Requirement: ${requirement}`,
    'Use HTML/CSS/GSAP with a defined visual identity, deterministic timing, and layout-before-animation.',
    'Render a transparent or web-ready WebM loop suitable for a premium gaming hero section.',
    'Run npx hyperframes lint, validate, inspect, and render before marking the asset pass.',
    'Do not bake navigation, body copy, buttons, cards, forms, browser chrome, screenshots, PDF renders, or reference crops into the video asset.'
  ].join(' ');
}

function makeAssetPlan({ requirements, screens = [], referenceImages = [], viewport, assetQualityRequired }) {
  const referenceSpecs = assetQualityRequired
    ? referenceBackedAssetSpecs({ requirements, screens, referenceImages, viewport })
    : [];
  const coveredReferenceRoles = new Set(referenceSpecs.map((asset) => asset.role));
  const threeDRequirements = unique(requirements.filter(isThreeDModelRequirement));
  const assetRequirements = unique(
    requirements.filter((item) => isGeneratedAssetRequirement(item) && (isHyperframesAssetRequirement(item) || !isThreeDModelRequirement(item)))
  ).filter((requirement) => {
    if (referenceSpecs.length === 0 || isHyperframesAssetRequirement(requirement)) {
      return true;
    }
    const role = assetRoleForRequirement(requirement);
    return !coveredReferenceRoles.has(role) && !(role === 'cinematic-hero' && coveredReferenceRoles.has('hero-emblem'));
  });
  if (assetQualityRequired && assetRequirements.length === 0 && threeDRequirements.length === 0 && referenceSpecs.length === 0) {
    assetRequirements.push('Premium hero, image, raster, 3D, glass, cinematic, texture, or rendered asset mentioned by the PRD.');
  }

  const minNativeWidth = Math.max(viewport.width * 2, 1920);
  const minNativeHeight = Math.max(Math.round(viewport.height * 1.2), 1080);
  const assets = [];
  for (const spec of referenceSpecs) {
    const id = `asset-${String(assets.length + 1).padStart(3, '0')}`;
    assets.push({
      id,
      ...spec
    });
  }

  for (const requirement of assetRequirements) {
    const assetNumber = assets.length + 1;
    const id = `asset-${String(assetNumber).padStart(3, '0')}`;
    const targetSuffix = String(assetNumber).padStart(2, '0');
    const role = assetRoleForRequirement(requirement);
    const hyperframes = isHyperframesAssetRequirement(requirement);
    if (hyperframes) {
      assets.push({
        id,
        status: 'pending',
        phase: phaseForRequirement(requirement),
        role,
        requirement,
        tool: 'hyperframes',
        implementation: 'hyperframes-composition-rendered-video',
        targetPath: `public/betterref-assets/${slug(role)}-${targetSuffix}.webm`,
        compositionDir: `hyperframes/${id}`,
        outputFormat: 'webm',
        prompt: makeHyperframesPrompt({ requirement, role, viewport }),
        hyperframesCommands: [
          'npx hyperframes lint',
          'npx hyperframes validate',
          'npx hyperframes inspect --json',
          'npx hyperframes render --format webm --quality high'
        ],
        acceptanceCriteria: [
          'Do not use PRD/PDF/reference crop or screenshot as the asset.',
          'Composition must trace palette and typography to DESIGN.md or explicit PRD direction.',
          'npx hyperframes lint, validate, inspect, and render must pass before attach.',
          'Rendered WebM/MP4 asset must be wired into the actual app and visible in fresh browser evidence.',
          'UI text, buttons, cards, forms, navigation, and layout remain code-native, not baked into the video.'
        ]
      });
      continue;
    }
    assets.push({
      id,
      status: 'pending',
      phase: phaseForRequirement(requirement),
      role,
      requirement,
      tool: 'image_gen',
      implementation: 'imagegen-or-production-asset',
      targetPath: `public/betterref-assets/${slug(role)}-${targetSuffix}.png`,
      minNativeWidth,
      minNativeHeight,
      minSharpness: 20,
      prompt: makeAssetPrompt({ requirement, role, viewport }),
      acceptanceCriteria: [
        'Do not use PRD/PDF/reference crop or screenshot as the asset.',
        'Native asset dimensions must be at least the rendered browser size.',
        'Asset must pass BetterRef guard sharpness checks.',
        'UI text, buttons, cards, and layout remain code-native, not baked into the raster.',
        'Mark status pass only after fresh browser evidence and guard verification.'
      ]
    });
  }

  const threeDAssets = threeDRequirements.map((requirement, index) => ({
    id: `model-${String(index + 1).padStart(3, '0')}`,
    status: 'pending',
    phase: phaseForRequirement(requirement),
    role: 'hunyuan-3d-model',
    requirement,
    tool: 'hunyuan3d',
    implementation: 'hunyuan-3d-model-via-tencent-api',
    targetPath: `public/betterref-assets/hunyuan-model-${String(index + 1).padStart(2, '0')}.glb`,
    targetFormat: 'glb',
    acceptanceCriteria: [
      'Generated GLB must be a true 3D mesh, not a flat billboard or single image plane.',
      'Model must runtime-load successfully in Three.js or model-viewer from the target path.',
      'Evidence must include mesh stats such as vertex/triangle counts and texture/material names.',
      'Evidence must include turntable or multi-angle screenshots/video from fresh browser or viewer capture.',
      'When texture or material is requested, evidence must show the material/texture applied to the mesh.'
    ]
  }));
  const allAssets = [...assets, ...threeDAssets];

  const hyperframesRequired = allAssets.some((asset) => asset.tool === 'hyperframes');
  const imagegenRequired = allAssets.some((asset) => asset.tool === 'image_gen');
  const minimumRenderedAssets = referenceSpecs.length > 0
    ? Math.min(12, allAssets.length)
    : allAssets.length > 0
      ? 1
      : 0;

  return {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired,
    hyperframesRequired,
    threeDRequired: threeDAssets.length > 0,
    minimumRenderedAssets,
    assets: allAssets
  };
}

function makePrdChecklist({ requirements, hardFailHints, screens, viewport, longReference }) {
  const sourceItems = unique([
    ...requirements,
    ...hardFailHints.map((item) => `Hard fail: ${item}`),
    ...screens.map((item) => `Screen required: ${item}`)
  ]);
  const items = sourceItems.map((item, index) => ({
    id: `prd-${String(index + 1).padStart(3, '0')}`,
    status: 'pending',
    category: classifyRequirement(item),
    phase: phaseForRequirement(item),
    requirement: item
  }));

  return {
    schemaVersion: 'betterref.prd.checklist.v1',
    viewport: viewportString(viewport),
    longReference,
    items
  };
}

function makeGuardConfig({
  viewport,
  hardFailHints,
  longReference,
  assetQualityRequired,
  imagegenRequired,
  minRenderedAssets
}) {
  const config = {
    schemaVersion: 'betterref.guard.config.v1',
    longReference,
    targetViewport: {
      width: viewport.width,
      height: viewport.height
    },
    requireBrowserEvidence: true,
    requireDomText: true,
    minInteractiveElements: 1,
    maxNativeScaleRatio: 1.05,
    forbiddenSourcePatterns: [
      'assets/reference',
      'homepage-reference',
      'full-page-reference',
      'pdf-render',
      'figma-export',
      'reference-crop'
    ],
    sourceExtensions: ['.tsx', '.jsx', '.ts', '.js', '.css', '.html'],
    hardFailHints
  };
  if (assetQualityRequired) {
    config.minRenderedAssets = Math.max(1, Number(minRenderedAssets) || 1);
  }
  if (imagegenRequired) {
    config.autoAssetQuality = {
      enabled: true,
      minSharpness: 20,
      roots: ['public']
    };
  }
  return config;
}

function viewportString(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function region(name, x, y, width, height, weight = 1) {
  return {
    name,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    weight
  };
}

function inferRegions(text, viewport) {
  const lower = text.toLowerCase();
  const width = viewport.width;
  const height = viewport.height;
  const headerH = Math.round(height * 0.085);
  const regions = [];

  const addIf = (name, patterns, rect) => {
    if (patterns.some((pattern) => lower.includes(pattern))) {
      regions.push(region(name, ...rect));
    }
  };

  addIf('header', ['header', 'nav', 'navbar', 'navigation', 'เมนู'], [0, 0, width, headerH, 1.25]);
  addIf('hero', ['hero', 'landing', 'mascot', 'banner', 'ฮีโร่', 'หน้าแรก'], [0, headerH, width, height * 0.52, 1.5]);
  addIf('cards', ['card', 'cards', 'grid', 'เกม', 'package', 'popular', 'แพ็ก', 'รายการ'], [0, height * 0.58, width * 0.72, height * 0.32, 1.15]);
  addIf('news', ['news', 'update', 'ข่าว'], [width * 0.68, height * 0.54, width * 0.32, height * 0.22, 1]);
  addIf('security', ['security', 'ssl', 'pci', 'ปลอดภัย'], [width * 0.72, height * 0.72, width * 0.28, height * 0.2, 1]);
  addIf('footer', ['footer', 'ท้าย', 'bottom'], [0, height * 0.9, width, height * 0.1, 0.75]);

  if (regions.length === 0) {
    regions.push(
      region('header', 0, 0, width, headerH, 1),
      region('hero', 0, headerH, width, height * 0.52, 1),
      region('content', 0, height * 0.58, width, height * 0.34, 1)
    );
  }

  return uniqueRegions(regions);
}

function uniqueRegions(regions) {
  const seen = new Set();
  return regions.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function inferIgnoreRegions(text, viewport) {
  const lower = text.toLowerCase();
  const ignores = [];
  if (/timestamp|time|clock|เวลา/.test(lower)) {
    ignores.push(region('timestamp', viewport.width - 180, 20, 150, 32, 1));
  }
  if (/cursor|pointer|เคอร์เซอร์/.test(lower)) {
    ignores.push(region('cursor', viewport.width / 2 - 24, viewport.height / 2 - 24, 48, 48, 1));
  }
  if (/ads?|advertisement|โฆษณา/.test(lower)) {
    ignores.push(region('ads', viewport.width - 320, 80, 300, 250, 1));
  }
  return ignores;
}

function markdownList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- No explicit items found in PRD text.';
}

function inlineList(items) {
  return items.length > 0 ? items.join(', ') : 'No explicit items found';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mergeManagedAgentsBlock(existing, block) {
  const current = String(existing || '');
  const normalizedBlock = String(block || '').trim();
  const pattern = new RegExp(`${escapeRegExp(AGENTS_BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(AGENTS_END_MARKER)}`);
  if (pattern.test(current)) {
    return `${current.replace(pattern, normalizedBlock).trimEnd()}\n`;
  }
  if (!current.trim()) {
    return `${normalizedBlock}\n`;
  }
  return `${current.trimEnd()}\n\n${normalizedBlock}\n`;
}

export function makeAgentsContract({ summary, paths, skillPaths = DEFAULT_SKILL_PATHS }) {
  return `${AGENTS_BEGIN_MARKER}
# BetterRef Project Agent Contract

Generated by \`betterref-prd\`. This managed block represents the project owner's default implementation contract for PRD-to-web work. Preserve project-specific instructions outside this block.

## Mandatory Skill Rule

For every non-trivial coding, review, debugging, cleanup, handoff, planning, PRD, or visual-implementation task, read and apply these skills before acting:

- \`$using-superpowers\`: \`${skillPaths.usingSuperpowers}\`
- \`$karpathy-guidelines\`: \`${skillPaths.karpathyGuidelines}\`
- \`$betterref\`: \`${skillPaths.betterref}\`

## Karpathy Gate

Before implementation:

1. State the real user requirement.
2. Define success criteria that prove the real requirement, not a proxy metric.
3. Surface assumptions and tradeoffs before choosing an approach.
4. Confirm planned changes trace directly to the request.
5. Identify verification evidence before claiming completion.

Before marking a phase complete, re-check the success criteria against the real output. If a metric passes but the PRD, UI behavior, browser evidence, or hard-fail ledger fails, the work fails.

## BetterRef PRD/Visual Contract

- Reference screenshots, PDF renders, and crops are evidence only; never ship them as UI.
- Build navigation, text, buttons, cards, forms, layout, and scroll behavior as code-native UI.
- Use \`imagegen\` or production assets for complex static raster, 3D, glass, cinematic, mascot, texture, or premium image work; save generated assets into declared output slots, attach them, and verify fresh browser evidence renders them.
- Use HyperFrames for animated/cinematic motion assets, reveals, loops, shader transitions, WebM/MP4, or website-to-video work.
- BetterRef score is supporting evidence only. PRD compliance, real component UI, browser evidence, asset evidence, and hard-fail ledger decide completion.
- A phase cannot pass with screenshot-as-UI, PDF-as-UI, wrong crop, missing scroll, blur, clipping, pending/fake-passed assets, missing browser evidence, or missing final verdict bundle.

## Project PRD Context

- Viewport: ${summary.viewport}
- Reference diff viewport: ${summary.referenceDiffViewport ? `${summary.referenceDiffViewport.width}x${summary.referenceDiffViewport.height} (${summary.referenceDiffViewport.role})` : 'Not specified separately'}
- Extracted reference images: ${Array.isArray(summary.referenceImages) ? summary.referenceImages.length : 0}
- Screens: ${inlineList(summary.screens)}
- Long-page reference: ${Boolean(summary.longReference)}
- Asset quality required: ${Boolean(summary.assetQualityRequired)}
- Imagegen required: ${Boolean(summary.imagegenRequired)}
- HyperFrames required: ${Boolean(summary.hyperframesRequired)}
- PRD summary: ${paths.summaryPath}
- PRD checklist: ${paths.prdChecklistPath}
- Asset plan: ${paths.assetPlanPath}
- Guard config: ${paths.guardConfigPath}
- BetterRef runbook: ${paths.runbookPath}

## Minimum Verification

- Run project lint/build/tests required by the repo.
- Capture fresh desktop browser evidence at the PRD viewport and mobile evidence when responsive behavior exists.
- Run BetterRef guard/final verification with PRD, asset plan, browser evidence, and long-page evidence when applicable.
- Do not say "100%" unless all PRD criteria, visual criteria, and hard-fail ledger items are verified.
${AGENTS_END_MARKER}`;
}

async function writeAgentsMd({ projectDir, block }) {
  if (!projectDir) {
    return null;
  }
  const root = path.resolve(projectDir);
  await mkdir(root, { recursive: true });
  const agentsPath = path.join(root, 'AGENTS.md');
  let existing = '';
  try {
    existing = await readFile(agentsPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await writeFile(agentsPath, mergeManagedAgentsBlock(existing, block));
  return agentsPath;
}

function makeRunbook({
  configPath,
  summaryPath,
  guardConfigPath,
  prdChecklistPath,
  assetPlanPath,
  referencePath,
  url,
  assetQualityRequired,
  hyperframesRequired,
  threeDRequired
}) {
  const reference = referencePath || 'path/to/reference.png';
  const targetUrl = url || 'http://127.0.0.1:3000/';
  const requiredGates = ['guard', 'prd', 'longpage', 'assetplan', 'browser'];
  if (threeDRequired) {
    requiredGates.push('3d');
  }
  const threeDVerifyFlag = threeDRequired ? ' --three-d .betterref-3d/3d-verdict.json' : '';
  const assetQualityNote = assetQualityRequired
    ? `
## Asset Quality Gate

The generated guard config requires rendered production assets in browser evidence. Raster assets use \`autoAssetQuality\`; animated HyperFrames assets require CLI evidence plus rendered browser video evidence.
`
    : '';
  const hyperframesSection = hyperframesRequired
    ? `
## HyperFrames Motion Asset Loop

\`\`\`bash
betterref-hyperframes --asset-plan ${assetPlanPath} --out .betterref-hyperframes --json
# Build each request with the hyperframes and hyperframes-cli skills, then verify:
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect --json
npx hyperframes render --format webm --quality high
# Attach the rendered output and CLI evidence:
betterref-hyperframes --asset-plan ${assetPlanPath} --attach asset-001=path/to/rendered.webm --evidence path/to/hyperframes-evidence.json --project . --json
\`\`\`
`
    : '';
  const threeDSection = threeDRequired
    ? `
## Hunyuan 3D Model Loop

\`\`\`bash
betterref-reference --ref ${reference} --out .betterref-reference --target ui,3d,hunyuan --json
betterref-3d --make-plan --analysis .betterref-reference/reference-analysis.json --asset-plan ${assetPlanPath} --out .betterref-3d --format glb --json
# Signed Tencent HY 3D Global API path. Prefer Pro 3.1 for multi-view/latest; Rapid is the single-view fallback.
# Use TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY when set, or the Blender MCP Hunyuan official API credentials on this workstation.
betterref-3d --make-hunyuan-request --plan .betterref-3d/3d-asset-plan.json --out .betterref-3d --provider tencent --tencent-endpoint hunyuan.intl.tencentcloudapi.com --tencent-region ap-singapore --tencent-edition rapid --result-format GLB --enable-pbr true --json
# Do not use Blender MCP legacy/domestic Hunyuan generation as the final BetterRef source; require Tencent ResultFile3Ds metadata.
betterref-3d --verify --plan .betterref-3d/3d-asset-plan.json --evidence .betterref-3d/3d-evidence.json --hunyuan-request .betterref-3d/hunyuan-request.json --hunyuan-response .betterref-3d/hunyuan-response.json --project . --out .betterref-3d --json
\`\`\`
`
    : '';
  return `# BetterRef PRD Runbook

## Inputs

- PRD summary: ${summaryPath}
- BetterRef config: ${configPath}
- BetterRef guard config: ${guardConfigPath}
- PRD checklist: ${prdChecklistPath}
- Asset plan: ${assetPlanPath}
${assetQualityNote}

## Asset Generation Loop

\`\`\`bash
betterref-imagegen --asset-plan ${assetPlanPath} --out .betterref-imagegen --json
# Use built-in image_gen for each request and save/copy selected outputs to:
# .betterref-imagegen/generated/<asset-id>.png
betterref-imagegen --asset-plan ${assetPlanPath} --status --out .betterref-imagegen --project . --json
betterref-imagegen --asset-plan ${assetPlanPath} --auto-attach-dir .betterref-imagegen/generated --project . --json
# Re-run status with browser evidence after the asset is wired into the app:
betterref-imagegen --asset-plan ${assetPlanPath} --status --out .betterref-imagegen --project . --browser-evidence .betterref/browser-evidence.json --json
\`\`\`
${hyperframesSection}

## Chrome Capture Loop

\`\`\`bash
betterref-chrome --endpoint http://127.0.0.1:9222 --url-match ${targetUrl} --out .betterref --full-page --section-screenshots --ref ${reference} --regions both --html
# If using @chrome or Chrome MCP instead of CDP, write .betterref-run/chrome-handoff.json with real screenshot paths and rerun:
betterref-run --pdf PRD.pdf --project . --ref ${reference} --url ${targetUrl} --browser-handoff .betterref-run/chrome-handoff.json --json
betterref-longpage --ref ${reference} --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
\`\`\`

Chrome handoff evidence must include a real viewport screenshot path, page/viewport metadata, DOM boxes, console/network evidence, and image/video natural/rendered sizes. Metadata-only browser evidence is a hard fail.

## Existing Screenshot Loop

\`\`\`bash
betterref-diff --ref ${reference} --actual path/to/current-screenshot.png --out .betterref --config ${configPath} --regions both --html
\`\`\`
${threeDSection}

## Guard And Final Verdict

\`\`\`bash
betterref-guard --project . --report .betterref/report.json --config ${guardConfigPath} --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd ${prdChecklistPath} --asset-plan ${assetPlanPath} --browser-evidence .betterref/browser-evidence.json --project .${threeDVerifyFlag} --require ${requiredGates.join(',')} --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
\`\`\`

## Patch Rule

Read \`.betterref/report.json\`, fix the highest-severity region first, capture again, and repeat until hard fails are gone.
`;
}

export async function buildPrdArtifacts(options) {
  const {
    pdfPath,
    outDir,
    configOut,
    viewport: viewportOption,
    referencePath,
    url,
    projectDir
  } = options;

  if (!pdfPath) {
    throw new BetterRefPrdError('Missing --pdf.');
  }
  if (!outDir) {
    throw new BetterRefPrdError('Missing --out.');
  }

  await mkdir(outDir, { recursive: true });
  const { text, pageCount } = await extractPdfText(pdfPath);
  const viewport = parseViewport(text, viewportOption);
  const referenceDiffViewport = parseReferenceDiffViewport(text);
  const additionalDesktopViewports = parseAdditionalDesktopViewports(text, viewport);
  const mobileViewport = parseMobileViewport(text);
  const thresholds = parseThresholds(text);
  const requirements = parseRequirements(text);
  const hardFailHints = parseHardFails(text);
  const screens = parseScreens(text);
  const longReference = inferLongReference(text);
  const assetQualityRequired = inferAssetQualityRequired(text, requirements);
  const hyperframesRequired = inferHyperframesRequired(requirements);
  const threeDRequired = inferThreeDRequired(requirements);
  const hunyuanRequired = inferHunyuanRequired(requirements);
  const regions = inferRegions(text, viewport);
  const ignoreRegions = inferIgnoreRegions(text, viewport);
  const summaryPath = path.join(outDir, 'prd-summary.json');
  const requirementsPath = path.join(outDir, 'requirements.md');
  const checklistPath = path.join(outDir, 'visual-checklist.md');
  const prdChecklistPath = path.join(outDir, 'prd-checklist.json');
  const assetPlanPath = path.join(outDir, 'asset-plan.json');
  const guardConfigPath = path.join(outDir, 'betterref.guard.json');
  const runbookPath = path.join(outDir, 'betterref-runbook.md');
  const configPath = configOut || path.join(outDir, '.betterref.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  const extractedReferences = await extractPdfReferenceImages({ pdfPath, outDir, projectDir, screens });
  const resolvedReferencePath = referencePath || extractedReferences.references[0]?.file || null;

  const summary = {
    schemaVersion: 'betterref.prd.summary.v1',
    generatedAt: new Date().toISOString(),
    pdfPath,
    pageCount,
    viewport: viewportString(viewport),
    viewportSource: viewport.source,
    referenceDiffViewport,
    additionalDesktopViewports,
    mobileViewport,
    referenceImages: extractedReferences.references,
    referenceManifestPath: extractedReferences.manifestPath,
    referenceExtractionWarning: extractedReferences.warning || null,
    screens,
    requirements,
    hardFailHints,
    longReference,
    assetQualityRequired,
    hyperframesRequired,
    threeDRequired,
    hunyuanRequired,
    thresholds,
    regions: regions.map((item) => item.name),
    ignoreRegions: ignoreRegions.map((item) => item.name),
    extractedTextPreview: text.slice(0, 4000)
  };
  const config = {
    viewport: viewportString(viewport),
    matchSize: 'strict',
    thresholds,
    regions,
    ignoreRegions,
    metadata: {
      generatedBy: 'betterref-prd',
      generatedAt: new Date().toISOString(),
      source: pdfPath,
      summaryPath,
      referenceImages: extractedReferences.references
    }
  };
  const prdChecklist = makePrdChecklist({ requirements, hardFailHints, screens, viewport, longReference });
  const assetPlan = makeAssetPlan({
    requirements,
    screens,
    referenceImages: extractedReferences.references,
    viewport,
    assetQualityRequired
  });
  const guardConfig = makeGuardConfig({
    viewport,
    hardFailHints,
    longReference,
    assetQualityRequired,
    imagegenRequired: assetPlan.imagegenRequired,
    minRenderedAssets: assetPlan.minimumRenderedAssets
  });
  if (referenceDiffViewport) {
    guardConfig.referenceViewport = {
      width: referenceDiffViewport.width,
      height: referenceDiffViewport.height
    };
    guardConfig.referenceViewportRole = referenceDiffViewport.role;
    prdChecklist.referenceViewport = guardConfig.referenceViewport;
    prdChecklist.referenceViewportRole = referenceDiffViewport.role;
  }
  if (additionalDesktopViewports.length > 0) {
    guardConfig.additionalDesktopViewports = additionalDesktopViewports;
    prdChecklist.additionalDesktopViewports = additionalDesktopViewports;
  }
  if (mobileViewport) {
    guardConfig.mobileViewport = mobileViewport;
    prdChecklist.mobileViewport = mobileViewport;
  }
  const artifactPaths = {
    summaryPath,
    requirementsPath,
    checklistPath,
    prdChecklistPath,
    assetPlanPath,
    guardConfigPath,
    runbookPath,
    configPath,
    referenceManifestPath: extractedReferences.manifestPath
  };
  let agentsPath = null;

  const requirementsMarkdown = `# PRD Requirements

## Screens

${markdownList(screens)}

## Requirements

${markdownList(requirements)}

## Hard Fail Hints

${markdownList(hardFailHints)}
`;
  const checklistMarkdown = `# BetterRef Visual Checklist

## Regions

${markdownList(regions.map((item) => `${item.name}: ${item.x},${item.y},${item.width},${item.height}`))}

## Hard Fails

${markdownList(hardFailHints)}

## Minimum Gates

- Same route, viewport, scroll position, and data state as the PRD reference.
- No incoherent overlap, clipping, or horizontal overflow.
- Typography and Thai glyphs must match the reference closely.
- Highest-severity BetterRef region must be patched first.
`;

  summary.imagegenRequired = assetPlan.imagegenRequired;
  summary.hyperframesRequired = assetPlan.hyperframesRequired;
  summary.threeDRequired = assetPlan.threeDRequired;
  summary.agentsPath = null;
  summary.agentsGenerated = false;

  if (projectDir) {
    const expectedAgentsPath = path.join(path.resolve(projectDir), 'AGENTS.md');
    agentsPath = await writeAgentsMd({
      projectDir,
      block: makeAgentsContract({
        summary: {
          ...summary,
          agentsPath: expectedAgentsPath,
          agentsGenerated: true
        },
        paths: {
          ...artifactPaths,
          agentsPath: expectedAgentsPath
        }
      })
    });
    summary.agentsPath = agentsPath;
    summary.agentsGenerated = true;
  }

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(guardConfigPath, `${JSON.stringify(guardConfig, null, 2)}\n`);
  await writeFile(prdChecklistPath, `${JSON.stringify(prdChecklist, null, 2)}\n`);
  await writeFile(assetPlanPath, `${JSON.stringify(assetPlan, null, 2)}\n`);
  await writeFile(requirementsPath, requirementsMarkdown);
  await writeFile(checklistPath, checklistMarkdown);
  await writeFile(
    runbookPath,
    makeRunbook({
      configPath,
      summaryPath,
      guardConfigPath,
      prdChecklistPath,
      assetPlanPath,
      referencePath: resolvedReferencePath,
      url,
      assetQualityRequired,
      hyperframesRequired: assetPlan.hyperframesRequired,
      threeDRequired: assetPlan.threeDRequired
    })
  );

  return {
    schemaVersion: 'betterref.prd.v1',
    generatedAt: new Date().toISOString(),
    pdfPath,
    viewport: viewportString(viewport),
    screens,
    requirements,
    hardFailHints,
    artifacts: {
      ...artifactPaths,
      agentsPath,
      referenceImages: extractedReferences.references
    }
  };
}
