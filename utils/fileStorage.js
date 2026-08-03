const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const MIME_EXTENSION_MAP = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/pdf': '.pdf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/x-rar-compressed': '.rar',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-7z-compressed': '.7z',
  'text/plain': '.txt',
};

const sanitizeBaseName = (fileName = 'file') => {
  const normalized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'file';
};

const parseDataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string') {
    throw new Error('Uploaded file data is missing');
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Uploaded file data is invalid');
  }

  return {
    mimeType: match[1],
    base64Data: match[2],
  };
};

const inferExtension = (fileName, mimeType) => {
  const extensionFromName = path.extname(fileName || '').toLowerCase();

  if (extensionFromName) {
    return extensionFromName;
  }

  return MIME_EXTENSION_MAP[mimeType] || '';
};

const saveBase64Upload = ({
  upload,
  maxBytes,
  label,
  allowedExtensions,
  subdirectories,
}) => {
  if (!upload) {
    throw new Error(`${label} is missing`);
  }

  const uploadName = typeof upload === 'string' ? `${label}` : upload.name;
  const uploadDataUrl = typeof upload === 'string' ? upload : upload.dataUrl;

  if (!uploadName || !uploadDataUrl) {
    throw new Error(`${label} is missing`);
  }

  const { mimeType, base64Data } = parseDataUrl(uploadDataUrl);
  const extension = inferExtension(uploadName, mimeType);

  if (!allowedExtensions.has(extension)) {
    throw new Error(`${label} format is not supported`);
  }

  const fileBuffer = Buffer.from(base64Data, 'base64');

  if (!fileBuffer.length) {
    throw new Error(`${label} could not be processed`);
  }

  if (fileBuffer.length > maxBytes) {
    throw new Error(`${label} must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`);
  }

  const absoluteDirectory = path.join(UPLOAD_ROOT, ...subdirectories);
  fs.mkdirSync(absoluteDirectory, { recursive: true });

  const baseName = sanitizeBaseName(path.basename(uploadName, extension));
  const generatedName = `${Date.now()}-${crypto.randomUUID()}-${baseName}${extension}`;
  const absolutePath = path.join(absoluteDirectory, generatedName);

  fs.writeFileSync(absolutePath, fileBuffer);

  return `/uploads/${[...subdirectories, generatedName].join('/')}`;
};

const toStoredUrl = (relativePath) => relativePath;

const removeUploadedFile = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return;
  }

  let pathname = fileUrl;

  try {
    if (/^https?:\/\//i.test(fileUrl)) {
      pathname = new URL(fileUrl).pathname;
    }
  } catch {
    pathname = fileUrl;
  }

  const uploadMarker = '/uploads/';
  const markerIndex = pathname.indexOf(uploadMarker);

  if (markerIndex === -1) {
    return;
  }

  const relativeUploadPath = pathname.slice(markerIndex + uploadMarker.length);
  const absolutePath = path.normalize(path.join(UPLOAD_ROOT, ...relativeUploadPath.split('/')));
  const normalizedRoot = path.normalize(UPLOAD_ROOT);

  if (!absolutePath.startsWith(normalizedRoot)) {
    return;
  }

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

module.exports = {
  removeUploadedFile,
  saveBase64Upload,
  toStoredUrl,
};
