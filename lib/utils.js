export function parseParametersString(raw) {
  const result = {
    positive: "",
    negative: "",
    steps: "",
    sampler: "",
    scheduleType: "",
    cfgScale: "",
    seed: "",
    size: "",
    modelHash: "",
    model: "",
    loraHashes: "",
    version: "",
    rawParameters: raw ?? "",
  };

  if (!raw || typeof raw !== "string") {
    return result;
  }

  const negativeMatch = raw.match(/\nNegative prompt:\s*([\s\S]*?)(?:\nSteps:|$)/i);
  if (negativeMatch) {
    result.negative = negativeMatch[1].trim();
    result.positive = raw.slice(0, negativeMatch.index).trim();
  } else {
    const stepsIndex = raw.search(/\nSteps:\s*\d+/i);
    result.positive = (stepsIndex >= 0 ? raw.slice(0, stepsIndex) : raw).trim();
  }

  const pick = (pattern) => {
    const match = raw.match(pattern);
    return match ? match[1].trim() : "";
  };

  result.steps = pick(/Steps:\s*([^,\n]+)/i);
  result.sampler = pick(/Sampler:\s*([^,\n]+)/i);
  result.scheduleType = pick(/Schedule type:\s*([^,\n]+)/i);
  result.cfgScale = pick(/CFG scale:\s*([^,\n]+)/i);
  result.seed = pick(/Seed:\s*([^,\n]+)/i);
  result.size = pick(/Size:\s*([^,\n]+)/i);
  result.modelHash = pick(/Model hash:\s*([^,\n]+)/i);
  result.model = pick(/Model:\s*([^,\n]+)/i);
  result.loraHashes = pick(/Lora hashes:\s*"?([^"\n]+)"?/i);
  result.version = pick(/Version:\s*([^,\n]+)/i);

  return result;
}

function readUint32BE(view, offset) {
  return view.getUint32(offset, false);
}

function decodeLatin1(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 1) {
    output += String.fromCharCode(bytes[i]);
  }
  return output;
}

export function extractPngTextChunks(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (view.getUint8(i) !== signature[i]) {
      throw new Error("Not a valid PNG file");
    }
  }

  const chunks = {};
  let offset = 8;

  while (offset + 8 <= view.byteLength) {
    const length = readUint32BE(view, offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === "tEXt" && dataEnd <= view.byteLength) {
      const data = new Uint8Array(arrayBuffer, dataStart, length);
      const nullIndex = data.indexOf(0);
      if (nullIndex >= 0) {
        const keyword = decodeLatin1(data.slice(0, nullIndex));
        const text = decodeLatin1(data.slice(nullIndex + 1));
        chunks[keyword] = text;
      }
    }

    if (type === "IEND") break;
    offset = dataEnd + 4;
  }

  return chunks;
}

export async function parseImageFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  let rawParameters = "";

  try {
    const chunks = extractPngTextChunks(arrayBuffer);
    rawParameters = chunks.parameters || chunks["sd-metadata"] || chunks.Comment || "";
  } catch {
    rawParameters = "";
  }

  const parsed = parseParametersString(rawParameters);

  return {
    ...parsed,
    fileName: file.name || "",
  };
}

export async function createImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function normalizePromptText(prompt) {
  if (!prompt || typeof prompt !== "string") return "";

  const withCommas = prompt.replace(/\r\n|\r|\n/g, ",");
  return tagsToPrompt(promptToTags(withCommas));
}

export function tagsToPrompt(tags) {
  return tags.map((tag) => tag.trim()).filter(Boolean).join(", ");
}

const ANGLE_TAG_PATTERN = /<[^>]+>/g;

function splitPromptSegment(segment) {
  const trimmed = segment.trim();
  if (!trimmed) return [];

  const tags = [];
  let lastIndex = 0;

  for (const match of trimmed.matchAll(ANGLE_TAG_PATTERN)) {
    const before = trimmed.slice(lastIndex, match.index).trim();
    if (before) tags.push(before);
    tags.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  const after = trimmed.slice(lastIndex).trim();
  if (after) tags.push(after);

  return tags.length ? tags : [trimmed];
}

export function parseTagInput(input) {
  if (!input) return [];
  const normalized = input.replace(/<>/g, ",");
  return promptToTags(normalized);
}

export function promptToTags(prompt) {
  if (!prompt) return [];

  return prompt
    .split(",")
    .flatMap((part) => splitPromptSegment(part))
    .map((part) => part.trim())
    .filter(Boolean);
}
