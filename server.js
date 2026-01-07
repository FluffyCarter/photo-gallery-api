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

// ========== ВАЖНО ДЛЯ RENDER ==========
// Render предоставляет PORT через переменную окружения
// Слушаем на 0.0.0.0 чтобы принимать внешние соединения

// Middleware
app.use(helmet({
  // Отключаем CSP для упрощения (можно настроить позже)
  contentSecurityPolicy: false,
}));

// Настройки CORS для Render
const corsOptions = {
  origin: function (origin, callback) {
    // Разрешаем запросы без origin (например, из мобильных приложений)
    if (!origin) return callback(null, true);
    
    // Разрешаем локальную разработку и Render домен
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'https://photo-gallery-api.onrender.com',
      'https://*.onrender.com'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  maxAge: 86400 // 24 часа
};

app.use(cors(corsOptions));

// Предварительная обработка OPTIONS запросов
app.options('*', cors(corsOptions));

app.use(morgan('combined')); // Используем combined для лучшего логирования
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ========== ВАЖНО: ОБРАБОТКА ПУТЕЙ ДЛЯ RENDER ==========
// На Render файловая система временная, лучше хранить в памяти
// ИЛИ использовать внешнее хранилище (S3)

// Создаем временную папку для загрузок если её нет
const fs = require('fs');
const uploadDir = '/tmp/uploads'; // На Render используем /tmp
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Статические файлы
app.use('/uploads', express.static(uploadDir));

// Маршруты
app.use('/api/photos', photoRoutes);

// ========== ОСНОВНЫЕ ENDPOINTS ==========
// Health check (ВАЖНО для Render!)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Photo Gallery API',
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Подробная проверка БД
app.get('/api/debug/db', async (req, res) => {
  try {
    const db = require('./config/database');
    
    // Проверяем несколько запросов
    const [timeResult, countResult, versionResult] = await Promise.all([
      db.query('SELECT NOW() as time'),
      db.query('SELECT COUNT(*) as count FROM photos'),
      db.query('SELECT version() as version')
    ]);
    
    res.json({
      success: true,
      database: {
        time: timeResult.rows[0].time,
        photo_count: parseInt(countResult.rows[0].count),
        version: versionResult.rows[0].version,
        connection: 'OK'
      }
    });
  } catch (error) {
    console.error('Database debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Информация о сервере
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Photo Gallery API',
    version: '1.0.0',
    provider: 'Render.com',
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'Проверка здоровья' },
      { method: 'GET', path: '/api/info', description: 'Информация о API' },
      { method: 'GET', path: '/api/debug/db', description: 'Отладка БД' },
      { method: 'GET', path: '/api/photos', description: 'Список фото' },
      { method: 'POST', path: '/api/photos/upload', description: 'Загрузка фото' },
      { method: 'GET', path: '/api/photos/:id', description: 'Получить фото' },
      { method: 'GET', path: '/api/photos/:id/image', description: 'Получить изображение' },
      { method: 'POST', path: '/api/photos/bulk-upload', description: 'Массовая загрузка' }
    ],
    limits: {
      max_file_size: '10MB',
      supported_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      max_connections: 10
    }
  });
});

// Корневой маршрут
app.get('/', (req, res) => {
  res.redirect('/api/info');
});

// ========== ОБРАБОТКА ОШИБОК ==========
// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requested_url: req.originalUrl,
    method: req.method,
    available_endpoints: [
      '/api/health',
      '/api/info',
      '/api/photos',
      '/api/photos/upload'
    ]
  });
});

// Обработчик ошибок
app.use(errorHandler);

// ========== ЗАПУСК СЕРВЕРА ==========
// ВАЖНО: Слушаем на 0.0.0.0 для внешних подключений
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         PHOTO GALLERY API STARTED                ║
╠══════════════════════════════════════════════════╣
║ 🚀 Port:         ${PORT}                          ║
║ 🌍 Environment:  ${process.env.NODE_ENV || 'development'} ║
║ 🗄️  Database:     ${process.env.DATABASE_URL ? 'Render PostgreSQL' : 'Local'} ║
║ 📍 Host:         0.0.0.0 (external access)       ║
╠══════════════════════════════════════════════════╣
║ 📊 Health:       http://localhost:${PORT}/api/health  ║
║ ℹ️  Info:         http://localhost:${PORT}/api/info   ║
║ 🗃️  Photos API:   http://localhost:${PORT}/api/photos ║
╚══════════════════════════════════════════════════╝
  `);
});