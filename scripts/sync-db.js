const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log(`
╔══════════════════════════════════════════════════╗
║       СИНХРОНИЗАЦИЯ БАЗ ДАННЫХ                   ║
║       Локальная БД → Render БД                   ║
╚══════════════════════════════════════════════════╝
`);

// Конфигурация
const config = {
  localDb: {
    host: 'localhost',
    port: 5432,
    database: 'photo_gallery',
    user: 'gallery_app',
    password: '1812' // Ваш пароль из .env
  },
  tempDir: './temp_sync',
  backupFile: 'photos_backup.sql'
};

// Создаем интерфейс для ввода
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Вопрос с подтверждением
function askQuestion(query) {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

// Получаем DATABASE_URL из переменных окружения или запрашиваем
function getRenderDatabaseUrl() {
  // Пробуем получить из .env.production или .env
  try {
    const envProd = fs.readFileSync('.env.production', 'utf8');
    const match = envProd.match(/DATABASE_URL=(.+)/);
    if (match) {
      console.log('✅ Найден DATABASE_URL в .env.production');
      return match[1].trim();
    }
  } catch (e) {
    // файл не существует
  }
  
  // Пробуем из .env
  try {
    const env = fs.readFileSync('.env', 'utf8');
    const match = env.match(/DATABASE_URL=(.+)/);
    if (match) {
      console.log('✅ Найден DATABASE_URL в .env');
      return match[1].trim();
    }
  } catch (e) {
    // файл не существует
  }
  
  return null;
}

// Экспорт из локальной БД
function exportLocalDatabase() {
  console.log('\n📤 Шаг 1: Экспорт из локальной БД...');
  
  const { host, port, database, user, password } = config.localDb;
  
  // Создаем команду для pg_dump
  // Экспортируем только данные (без схемы) и только таблицу photos
  const dumpCommand = `set PGPASSWORD=${password} && pg_dump -h ${host} -p ${port} -U ${user} -d ${database} -t photos --data-only --inserts -f ${path.join(config.tempDir, config.backupFile)}`;
  
  try {
    // Создаем временную директорию
    if (!fs.existsSync(config.tempDir)) {
      fs.mkdirSync(config.tempDir, { recursive: true });
    }
    
    console.log(`📊 Экспортируем таблицу photos...`);
    execSync(dumpCommand, { stdio: 'inherit', shell: true });
    
    // Проверяем размер файла
    const stats = fs.statSync(path.join(config.tempDir, config.backupFile));
    console.log(`✅ Экспорт завершен. Размер файла: ${(stats.size / 1024).toFixed(2)} KB`);
    
    // Показываем количество записей (примерно)
    const fileContent = fs.readFileSync(path.join(config.tempDir, config.backupFile), 'utf8');
    const insertCount = (fileContent.match(/INSERT INTO/g) || []).length;
    console.log(`📊 Количество записей для импорта: ${insertCount}`);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при экспорте:', error.message);
    return false;
  }
}

// Импорт в Render БД
function importToRenderDatabase(databaseUrl) {
  console.log('\n📥 Шаг 2: Импорт в Render БД...');
  
  const backupPath = path.join(config.tempDir, config.backupFile);
  
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Файл бэкапа не найден!');
    return false;
  }
  
  // Очищаем данные в Render БД перед импортом (опционально)
  const clearCommand = `psql "${databaseUrl}" -c "TRUNCATE photos RESTART IDENTITY CASCADE;"`;
  
  // Команда импорта
  const importCommand = `psql "${databaseUrl}" -f "${backupPath}"`;
  
  try {
    console.log('🧹 Очищаем таблицу photos в Render БД...');
    execSync(clearCommand, { stdio: 'pipe', shell: true });
    
    console.log('📥 Импортируем данные...');
    execSync(importCommand, { stdio: 'inherit', shell: true });
    
    console.log('✅ Импорт завершен!');
    
    // Проверяем что данные загрузились
    const checkCommand = `psql "${databaseUrl}" -c "SELECT COUNT(*) as count FROM photos;"`;
    const result = execSync(checkCommand, { encoding: 'utf8', shell: true });
    console.log(`📊 Проверка: ${result}`);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при импорте:', error.message);
    console.error('Возможные причины:');
    console.error('1. Неправильный DATABASE_URL');
    console.error('2. Нет доступа к Render БД');
    console.error('3. Проблемы с SSL соединением');
    return false;
  }
}

// Основная функция
async function main() {
  try {
    // 1. Проверяем подключение к локальной БД
    console.log('🔍 Проверка подключения к локальной БД...');
    try {
      const checkLocal = `psql -h ${config.localDb.host} -p ${config.localDb.port} -U ${config.localDb.user} -d ${config.localDb.database} -c "SELECT 1;"`;
      execSync(checkLocal, { stdio: 'pipe', shell: true, env: { ...process.env, PGPASSWORD: config.localDb.password } });
      console.log('✅ Локальная БД доступна');
    } catch {
      console.error('❌ Не могу подключиться к локальной БД!');
      console.log('Убедитесь что:');
      console.log('1. PostgreSQL запущен на вашем ПК');
      console.log('2. База данных photo_gallery существует');
      console.log('3. Пользователь gallery_app создан');
      process.exit(1);
    }
    
    // 2. Получаем DATABASE_URL для Render
    console.log('\n🔍 Поиск DATABASE_URL для Render...');
    let databaseUrl = getRenderDatabaseUrl();
    
    if (!databaseUrl) {
      console.log('DATABASE_URL не найден в .env файлах.');
      const manualUrl = await askQuestion('📝 Введите DATABASE_URL вручную: ');
      databaseUrl = manualUrl;
    } else {
      // Маскируем пароль в выводе
      const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
      console.log(`✅ Используем DATABASE_URL: ${maskedUrl}`);
    }
    
    // 3. Предупреждение
    console.log('\n⚠️  ВНИМАНИЕ!');
    console.log('Это действие:');
    console.log('1. Создаст бэкап локальной БД');
    console.log('2. ОЧИСТИТ существующие данные в Render БД');
    console.log('3. Загрузит данные из локальной БД в Render БД');
    
    const confirm = await askQuestion('\n❓ Продолжить? (yes/no): ');
    
    if (confirm !== 'yes' && confirm !== 'y') {
      console.log('❌ Отменено пользователем');
      rl.close();
      return;
    }
    
    // 4. Экспорт
    const exportSuccess = exportLocalDatabase();
    if (!exportSuccess) {
      rl.close();
      return;
    }
    
    // 5. Импорт
    const importSuccess = importToRenderDatabase(databaseUrl);
    
    // 6. Очистка временных файлов
    if (fs.existsSync(config.tempDir)) {
      fs.rmSync(config.tempDir, { recursive: true, force: true });
      console.log('🧹 Временные файлы удалены');
    }
    
    if (exportSuccess && importSuccess) {
      console.log(`
╔══════════════════════════════════════════════════╗
║       ✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА!                ║
║       Данные успешно перенесены                  ║
║       из локальной БД в Render БД                ║
╚══════════════════════════════════════════════════╝
      `);
      
      // Показываем ссылки
      console.log('\n🔗 Проверьте результаты:');
      console.log(`🌐 Render API: https://photo-gallery-api.onrender.com/api/photos`);
      console.log(`🏠 Локальный API: http://localhost:3000/api/photos`);
    }
    
  } catch (error) {
    console.error('❌ Неожиданная ошибка:', error);
  } finally {
    rl.close();
  }
}

// Запуск
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { exportLocalDatabase, importToRenderDatabase };