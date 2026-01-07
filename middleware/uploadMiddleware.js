const multer = require('multer');
const path = require('path');

// ВАЖНО: На Render используем memory storage, так как файловая система временная
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    console.log(`✅ Файл принят: ${file.originalname}, тип: ${file.mimetype}`);
    return cb(null, true);
  } else {
    console.log(`❌ Файл отклонен: ${file.originalname}, тип: ${file.mimetype}`);
    cb(new Error('Разрешены только файлы изображений (jpeg, jpg, png, gif, webp)!'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB
    files: 1 // максимум 1 файл за раз
  },
  fileFilter: fileFilter
});

// Middleware для обработки ошибок multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Размер файла слишком большой. Максимальный размер 10MB'
      });
    }
    return res.status(400).json({
      success: false,
      message: `Ошибка загрузки файла: ${err.message}`
    });
  }
  next(err);
};

module.exports = { upload, handleMulterError };