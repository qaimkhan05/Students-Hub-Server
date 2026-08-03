const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

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

const CLOUDINARY_URL_PATTERN = /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw)\/upload\/v\d+\/(.+)$/i;

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

const getCloudinaryConfig = () => {
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  };

  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    const error = new Error('Cloudinary is not configured on the server');
    error.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw error;
  }

  return config;
};

const uploadBufferToCloudinary = (fileBuffer, { mimeType, uploadName, extension, subdirectories }) =>
  new Promise((resolve, reject) => {
    try {
      cloudinary.config(getCloudinaryConfig());

      const folder = ['studenthub', ...subdirectories].join('/');
      const isImage = mimeType.startsWith('image/');
      const baseName = sanitizeBaseName(path.basename(uploadName, extension));
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}-${baseName}`;
      const publicId = isImage ? uniqueName : `${uniqueName}${extension}`;

      cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: isImage ? 'image' : 'raw',
          overwrite: true,
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        }
      ).end(fileBuffer);
    } catch (err) {
      reject(err);
    }
  });

const saveBase64Upload = async ({
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

  return uploadBufferToCloudinary(fileBuffer, { mimeType, uploadName, extension, subdirectories });
};

const toStoredUrl = (relativePath) => relativePath;

const removeUploadedFile = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return;
  }

  const cloudinaryMatch = fileUrl.match(CLOUDINARY_URL_PATTERN);

  if (cloudinaryMatch) {
    const resourceType = cloudinaryMatch[1];
    let publicId = cloudinaryMatch[2];

    if (resourceType === 'image') {
      publicId = publicId.replace(/\.[a-z0-9]+$/i, '');
    }

    try {
      cloudinary.config(getCloudinaryConfig());
      cloudinary.uploader
        .destroy(publicId, { resource_type: resourceType })
        .catch((err) => console.error('Cloudinary cleanup failed:', err.message));
    } catch (err) {
      console.error('Cloudinary cleanup skipped:', err.message);
    }
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
