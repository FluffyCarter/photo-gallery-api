const { Pool } = require('pg');
require('dotenv').config();

console.log('🔧 Настройка подключения к базе данных...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const getPoolConfig = () => {
  // ВАЖНО: Render предоставляет DATABASE_URL
  if (process.env.DATABASE_URL) {
    console.log('✅ Используем DATABASE_URL от Render');
    
    // Парсим DATABASE_URL для логирования (без пароля)
    const url = new URL(process.env.DATABASE_URL);
    console.log(`📊 Подключение к: ${url.hostname}:${url.port}/${url.pathname.substring(1)}`);
    
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false // ВАЖНО для Render PostgreSQL
      },
      max: 10, // Render Free plan ограничения
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    };
  }
  
  // Локальная разработка
  console.log('🖥️ Используем локальные настройки БД');
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'photo_gallery',
    user: process.env.DB_USER || 'gallery_app',
    password: process.env.DB_PASSWORD || '1812',
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  };
};

const pool = new Pool(getPoolConfig());

// Логирование подключений
pool.on('connect', () => {
  console.log('✅ Новое подключение к БД установлено');
});

pool.on('error', (err) => {
  console.error('❌ Ошибка подключения к БД:', err.message);
  console.error('Код ошибки:', err.code);
  console.error('Детали:', err);
});

// Тестируем подключение при старте
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Тест подключения к БД: УСПЕШНО');
    const result = await client.query('SELECT NOW() as time');
    console.log('🕒 Время БД:', result.rows[0].time);
    client.release();
  } catch (error) {
    console.error('❌ Тест подключения к БД: ОШИБКА');
    console.error('Детали ошибки:', error.message);
    console.error('Совет: проверьте DATABASE_URL и настройки SSL');
  }
}

// Запускаем тест при импорте
setTimeout(testConnection, 1000);

module.exports = {
  query: (text, params) => {
    console.log('📝 SQL запрос:', text.substring(0, 100) + '...');
    return pool.query(text, params);
  },
  pool,
  testConnection
};