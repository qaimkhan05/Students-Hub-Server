const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const Product = require('../models/Product');
const Order = require('../models/Order');
const {
  removeUploadedFile,
  saveBase64Upload,
  toStoredUrl,
} = require('../utils/fileStorage');

const THUMBNAIL_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp']);
const PRODUCT_FILE_EXTENSIONS = new Set([
  '.7z',
  '.doc',
  '.docx',
  '.pdf',
  '.ppt',
  '.pptx',
  '.rar',
  '.txt',
  '.xlsx',
  '.zip',
]);
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_FILE_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_ROOT = path.resolve(__dirname, '..', 'uploads');
const SAMPLES_ROOT = path.resolve(__dirname, '..', 'samples');
const LOCAL_PREFIXES = ['/uploads/', '/samples/'];

const getDownloadName = (product, parsedUrl) => {
  let fileName = parsedUrl.pathname.split('/').pop() || '';
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // Keep the original name when a malformed URL segment is supplied.
  }

  const fallbackName = `${product.title || 'resource'}.pdf`;
  const safeName = (fileName || fallbackName)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim();

  return safeName || fallbackName;
};

const getLocalUploadPath = (pathname) => {
  const prefix = LOCAL_PREFIXES.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) {
    return null;
  }

  const root = prefix === '/samples/' ? SAMPLES_ROOT : UPLOAD_ROOT;

  let relativePath;
  try {
    relativePath = pathname
      .slice(prefix.length)
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join(path.sep);
  } catch {
    return null;
  }

  const absolutePath = path.resolve(root, relativePath);
  const rootWithSeparator = `${root}${path.sep}`;
  if (!absolutePath.startsWith(rootWithSeparator)) {
    return null;
  }

  return absolutePath;
};

const proxyExternalFile = (fileUrl, res, fileName, redirectCount = 0) => {
  if (redirectCount > 3) {
    res.status(502).json({ message: 'The resource redirected too many times' });
    return;
  }

  const client = fileUrl.protocol === 'https:' ? https : http;
  const request = client.get(fileUrl, (remoteResponse) => {
    const redirectLocation = remoteResponse.headers.location;
    if (remoteResponse.statusCode >= 300 && remoteResponse.statusCode < 400 && redirectLocation) {
      remoteResponse.resume();
      proxyExternalFile(new URL(redirectLocation, fileUrl), res, fileName, redirectCount + 1);
      return;
    }

    if (remoteResponse.statusCode < 200 || remoteResponse.statusCode >= 300) {
      remoteResponse.resume();
      if (!res.headersSent) {
        res.status(502).json({ message: 'The resource file could not be downloaded' });
      }
      return;
    }

    res.setHeader('Content-Type', remoteResponse.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    if (remoteResponse.headers['content-length']) {
      res.setHeader('Content-Length', remoteResponse.headers['content-length']);
    }
    remoteResponse.pipe(res);
  });

  request.setTimeout(15000, () => request.destroy(new Error('Download request timed out')));
  request.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ message: 'The resource file could not be downloaded' });
    } else {
      res.end();
    }
  });
};

const cleanupUploads = (fileUrls = []) => {
  [...new Set(fileUrls.filter(Boolean))].forEach((fileUrl) => removeUploadedFile(fileUrl));
};

const prepareProductPayload = async (req, body, existingProduct = null) => {
  const payload = {
    title: body.title,
    description: body.description,
    price: body.price,
    category: body.category,
    fileUrl: body.fileUrl,
    thumbnailUrl: body.thumbnailUrl,
  };

  const savedUploadUrls = [];
  const previousUploadUrls = [];

  if (body.thumbnailUpload) {
    const relativeThumbnailPath = await saveBase64Upload({
      upload: body.thumbnailUpload,
      maxBytes: THUMBNAIL_MAX_BYTES,
      label: 'Thumbnail image',
      allowedExtensions: THUMBNAIL_EXTENSIONS,
      subdirectories: ['products', 'thumbnails'],
    });

    payload.thumbnailUrl = toStoredUrl(relativeThumbnailPath);
    savedUploadUrls.push(payload.thumbnailUrl);

    if (existingProduct?.thumbnailUrl) {
      previousUploadUrls.push(existingProduct.thumbnailUrl);
    }
  }

  if (body.courseUpload) {
    const relativeFilePath = await saveBase64Upload({
      upload: body.courseUpload,
      maxBytes: PRODUCT_FILE_MAX_BYTES,
      label: 'Course file',
      allowedExtensions: PRODUCT_FILE_EXTENSIONS,
      subdirectories: ['products', 'files'],
    });

    payload.fileUrl = toStoredUrl(relativeFilePath);
    savedUploadUrls.push(payload.fileUrl);

    if (existingProduct?.fileUrl) {
      previousUploadUrls.push(existingProduct.fileUrl);
    }
  }

  return {
    payload,
    previousUploadUrls,
    savedUploadUrls,
  };
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ success: true, data: product });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Create new product
// @route   POST /api/products
// @access  Private (Admin)
exports.createProduct = async (req, res) => {
  let savedUploadUrls = [];

  try {
    const prepared = await prepareProductPayload(req, req.body);
    savedUploadUrls = prepared.savedUploadUrls;

    const product = await Product.create(prepared.payload);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    cleanupUploads(savedUploadUrls);
    res.status(400).json({ message: err.message });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Admin)
exports.updateProduct = async (req, res) => {
  let savedUploadUrls = [];

  try {
    const existingProduct = await Product.findById(req.params.id);

    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const prepared = await prepareProductPayload(req, req.body, existingProduct);
    savedUploadUrls = prepared.savedUploadUrls;

    const product = await Product.findByIdAndUpdate(req.params.id, prepared.payload, {
      returnDocument: 'after',
      runValidators: true,
    });

    cleanupUploads(prepared.previousUploadUrls);

    res.status(200).json({ success: true, data: product });
  } catch (err) {
    cleanupUploads(savedUploadUrls);
    res.status(400).json({ message: err.message });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Admin)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await product.deleteOne();
    cleanupUploads([product.fileUrl, product.thumbnailUrl]);

    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Place an order
// @route   POST /api/products/checkout
// @access  Private
exports.checkout = async (req, res) => {
  try {
    const productIds = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds)] : [];

    if (!productIds.length) {
      return res.status(400).json({ message: 'Please select at least one product' });
    }

    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length !== productIds.length) {
      return res.status(400).json({ message: 'One or more selected products could not be found' });
    }

    const totalAmount = products.reduce((sum, product) => sum + product.price, 0);

    const order = await Order.create({
      user: req.user.id,
      products: productIds,
      totalAmount,
      status: 'Completed', // For simulation
      transactionId: `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
    });

    // Update sales count for products
    await Product.updateMany(
      { _id: { $in: productIds } },
      { $inc: { salesCount: 1 } }
    );

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Download a purchased product file
// @route   GET /api/products/:id/download
// @access  Private
exports.downloadProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('title fileUrl');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const canDownload = req.user.role === 'admin'
      || await Order.exists({
        user: req.user.id,
        status: 'Completed',
        products: product._id,
      });

    if (!canDownload) {
      return res.status(403).json({ message: 'Purchase this resource before downloading it' });
    }

    const parsedUrl = new URL(product.fileUrl, `${req.protocol}://${req.get('host')}`);
    const fileName = getDownloadName(product, parsedUrl);
    const localFilePath = getLocalUploadPath(parsedUrl.pathname);

    if (localFilePath) {
      if (!fs.existsSync(localFilePath)) {
        return res.status(404).json({ message: 'The resource file is missing' });
      }
      return res.download(localFilePath, fileName);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ message: 'The resource file URL is not supported' });
    }

    proxyExternalFile(parsedUrl, res, fileName);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
