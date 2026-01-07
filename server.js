const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const photoRoutes = require('./routes/photoRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const fs = require('fs');
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

app.use('/api/photos', photoRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Photo Gallery API',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/debug/db', async (req, res) => {
  try {
    const db = require('./config/database');
    const result = await db.query('SELECT NOW() as time');
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Database connection successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
});


app.get('/api/info', (req, res) => {
  res.json({
    name: 'Photo Gallery API',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'Проверка здоровья' },
      { method: 'GET', path: '/api/photos', description: 'Список фото' },
      { method: 'POST', path: '/api/photos/upload', description: 'Загрузка фото' }
    ]
  });
});

app.get('/', (req, res) => {
  res.redirect('/api/info');
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const multer = require('multer');
app.use((err, req, res, next) => {
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
});


app.use(errorHandler);


app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║         PHOTO GALLERY API STARTED                      ║
╠════════════════════════════════════════════════════════╣
║ Port:         ${PORT}                                  ║
║ Environment:  ${process.env.NODE_ENV || 'development'} ║
║ Host:         0.0.0.0                                  ║
╠════════════════════════════════════════════════════════╣
║ Health:       http://localhost:${PORT}/api/health 	 ║
║ Info:         http://localhost:${PORT}/api/info   	 ║
╚════════════════════════════════════════════════════════╝
  `);
});