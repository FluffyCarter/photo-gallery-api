#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const readline = require('readline');

console.log(`
╔══════════════════════════════════════════════════╗
║        ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ RENDER          ║
║        Создание таблицы photos                   ║
╚══════════════════════════════════════════════════╝
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function askQuestion(query) {
  return new Promise(resolve => {
    rl.question(query, answer => resolve(answer.trim()));
  });
}

async function getDatabaseUrl() {
  try {
    if (fs.existsSync('.env.production')) {
      const content = fs.readFileSync('.env.production', 'utf8');
      const match = content.match(/DATABASE_URL=(.+)/);
      if (match) {
        console.log(' Найден DATABASE_URL в .env.production');
        return match[1].trim();
      }
    }
    
    console.log(' DATABASE_URL не найден');
    return null;
  } catch (error) {
    console.log(' Ошибка чтения файла:', error.message);
    return null;
  }
}

async function initDatabase(databaseUrl) {
  console.log('\n Подключаюсь к Render БД...');
  
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const client = await pool.connect();
    console.log(' Подключение успешно');
    

    const createTableSQL = `
      -- Создание таблицы photos
      CREATE TABLE IF NOT EXISTS photos (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          image_data BYTEA NOT NULL,
          mime_type VARCHAR(50),
          file_size INTEGER,
          width INTEGER,
          height INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          description TEXT,
          tags TEXT[]
      );

      -- Индексы для ускорения поиска
      CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(filename);
      
      -- Если PostgreSQL поддерживает GIN индексы для массива
      DO $$
      BEGIN
          IF EXISTS (
              SELECT 1 FROM pg_type WHERE typname = '_text'
          ) THEN
              CREATE INDEX IF NOT EXISTS idx_photos_tags ON photos USING GIN(tags);
          END IF;
      END $$;

      -- Функция для автоматического обновления updated_at
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Триггер для автообновления updated_at
      DROP TRIGGER IF EXISTS update_photos_updated_at ON photos;
      CREATE TRIGGER update_photos_updated_at 
          BEFORE UPDATE ON photos 
          FOR EACH ROW 
          EXECUTE FUNCTION update_updated_at_column();
    `;
    
    console.log('\n🛠  Создаю таблицу photos...');
    await client.query(createTableSQL);
    console.log(' Таблица photos создана');
    
    const checkResult = await client.query(`
      SELECT 
        table_name,
        (SELECT COUNT(*) FROM photos) as row_count
      FROM information_schema.tables 
      WHERE table_name = 'photos'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log(` Таблица 'photos' существует в базе`);
      console.log(` Количество записей: ${checkResult.rows[0].row_count}`);
    }
    
    const structureResult = await client.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'photos'
      ORDER BY ordinal_position
    `);
    
    console.log('\n Структура таблицы photos:');
    console.log('┌─────────────────┬─────────────────┬──────────┬─────────────────┐');
    console.log('│ Колонка         │ Тип данных      │ Nullable │ Default         │');
    console.log('├─────────────────┼─────────────────┼──────────┼─────────────────┤');
    
    for (const column of structureResult.rows) {
      const name = column.column_name.padEnd(15);
      const type = column.data_type.padEnd(15);
      const nullable = column.is_nullable === 'YES' ? 'YES' : 'NO ';
      const defaultValue = column.column_default ? column.column_default.substring(0, 15) : '';
      console.log(`│ ${name} │ ${type} │ ${nullable}    │ ${defaultValue.padEnd(15)} │`);
    }
    
    console.log('└─────────────────┴─────────────────┴──────────┴─────────────────┘');
    
    client.release();
    console.log('\n Инициализация БД завершена успешно!');
    
    return true;
    
  } catch (error) {
    console.error(' Ошибка при создании таблицы:', error.message);
    console.error('\n Возможные причины:');
    console.error('1. Нет прав на создание таблиц');
    console.error('2. Проблемы с SQL синтаксисом');
    console.error('3. Ошибка подключения');
    return false;
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    let databaseUrl = await getDatabaseUrl();
    
    if (!databaseUrl) {
      console.log('\n Введите DATABASE_URL вручную:');
      databaseUrl = await askQuestion('DATABASE_URL: ');
      
      const save = await askQuestion('\n Сохранить в .env.production? (yes/no): ');
      if (save.toLowerCase() === 'yes') {
        fs.writeFileSync('.env.production', `DATABASE_URL=${databaseUrl}`);
        console.log(' Сохранено в .env.production');
      }
    }
    
    const displayUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`\n Используем: ${displayUrl}`);
    
    console.log('\n  ВНИМАНИЕ!');
    console.log('Это действие создаст таблицу photos в Render БД.');
    console.log('Если таблица уже существует, она будет обновлена.');
    
    const confirm = await askQuestion('\n Продолжить? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log(' Отменено пользователем');
      rl.close();
      return;
    }
    
    const success = await initDatabase(databaseUrl);
    
    if (success) {
      console.log('\n Теперь можно синхронизировать данные!');
      console.log('Запустите: npm run sync');
    }
    
  } catch (error) {
    console.error(' Неожиданная ошибка:', error.message);
  } finally {
    rl.close();
  }
}

// Запуск
if (require.main === module) {
  main().catch(console.error);
}