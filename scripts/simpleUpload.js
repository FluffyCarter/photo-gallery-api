#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const readline = require('readline');

console.log(`
╔══════════════════════════════════════════════════╗
║      МАССОВАЯ ЗАГРУЗКА ФОТО В ЛОКАЛЬНУЮ БД       ║
╚══════════════════════════════════════════════════╝
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => {
    rl.question(query, answer => resolve(answer.trim()));
  });
}


const LOCAL_DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'photo_gallery',
  user: 'gallery_app', 
  password: '1812'      
};


const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function checkDatabaseConnection() {
  console.log(' Проверка подключения к локальной БД...');
  
  const pool = new Pool(LOCAL_DB_CONFIG);
  
  try {
    const client = await pool.connect();
    

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'photos'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log(' Таблица photos не существует!');
      console.log('Создайте таблицу сначала или запустите:');
      console.log('npm run init-local-db');
      client.release();
      await pool.end();
      return false;
    }
    

    const countResult = await client.query('SELECT COUNT(*) as count FROM photos');
    const currentCount = parseInt(countResult.rows[0].count);
    console.log(` В БД сейчас: ${currentCount} фото`);
    
    client.release();
    await pool.end();
    
    return { connected: true, count: currentCount };
    
  } catch (error) {
    console.error(' Ошибка подключения к БД:', error.message);
    console.log('\n Возможные причины:');
    console.log('1. PostgreSQL не запущен');
    console.log('2. Неправильные настройки подключения');
    console.log('3. Пользователь или база данных не существуют');
    await pool.end();
    return { connected: false, count: 0 };
  }
}

function scanDirectoryForImages(dir) {
  const imageFiles = [];
  
  function walk(currentPath) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name);
        
        if (item.isDirectory()) {

          walk(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            imageFiles.push({
              path: fullPath,
              filename: item.name,
              extension: ext
            });
          }
        }
      }
    } catch (error) {
      console.error(`  Ошибка сканирования ${currentPath}:`, error.message);
    }
  }
  
  walk(dir);
  return imageFiles;
}

function getMimeType(extension) {
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff'
  };
  return mimeMap[extension] || 'image/jpeg';
}

async function processUpload(folderPath, clearExisting = false) {
  console.log(`\n Сканирую папку: ${folderPath}`);
  

  const imageFiles = scanDirectoryForImages(folderPath);
  
  if (imageFiles.length === 0) {
    console.log(' Изображения не найдены!');
    console.log('Поддерживаемые форматы:', SUPPORTED_EXTENSIONS.join(', '));
    return;
  }
  
  console.log(` Найдено ${imageFiles.length} изображений\n`);
  
  const pool = new Pool(LOCAL_DB_CONFIG);
  const client = await pool.connect();
  
  try {
    if (clearExisting) {
      console.log(' Очищаю таблицу photos...');
      await client.query('TRUNCATE photos RESTART IDENTITY CASCADE');
      console.log(' Таблица очищена');
    }
    
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    let duplicates = 0;
    
    console.log('\n Начинаю загрузку...\n');
    
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      
      try {
        const progress = ((i + 1) / imageFiles.length * 100).toFixed(1);
        process.stdout.write(`\r Прогресс: ${i + 1}/${imageFiles.length} (${progress}%)`);
        

        const stats = fs.statSync(file.path);
        if (stats.size > MAX_FILE_SIZE) {
          console.log(`\n  Пропускаю "${file.filename}" - слишком большой (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
          skipped++;
          continue;
        }
        

        if (!clearExisting) {
          const duplicateCheck = await client.query(
            'SELECT 1 FROM photos WHERE filename = $1 AND file_size = $2 LIMIT 1',
            [file.filename, stats.size]
          );
          
          if (duplicateCheck.rows.length > 0) {
            duplicates++;
            continue;
          }
        }
        

        const buffer = fs.readFileSync(file.path);
        const mimeType = getMimeType(file.extension);
        

        await client.query(
          `INSERT INTO photos 
           (filename, image_data, mime_type, file_size, description) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            file.filename,
            buffer,
            mimeType,
            stats.size,
            `Загружено из ${file.path}`
          ]
        );
        
        uploaded++;
        

        if ((i + 1) % 10 === 0 || (i + 1) === imageFiles.length) {
          console.log(`\n Загружено: ${file.filename}`);
        }
        
      } catch (error) {
        console.log(`\n Ошибка с "${file.filename}":`, error.message);
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(' РЕЗУЛЬТАТЫ ЗАГРУЗКИ:');
    console.log('='.repeat(50));
    console.log(` Всего файлов в папке: ${imageFiles.length}`);
    console.log(` Успешно загружено:    ${uploaded}`);
    console.log(` Пропущено (дубли):    ${duplicates}`);
    console.log(`  Пропущено (размер):  ${skipped}`);
    console.log(` Ошибок:              ${errors}`);
    console.log('='.repeat(50));
    

    const result = await client.query('SELECT COUNT(*) as count FROM photos');
    const totalInDb = parseInt(result.rows[0].count);
    console.log(` Итоговое количество фото в БД: ${totalInDb}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n Фатальная ошибка:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  try {

    const folderPath = process.argv[2] || 'D:/photos';
    
    if (!fs.existsSync(folderPath)) {
      console.error(` Папка "${folderPath}" не существует!`);
      console.log('\n Использование:');
      console.log('   node local-bulk-upload.js [путь_к_папке]');
      console.log('\n Пример:');
      console.log('   node local-bulk-upload.js "D:/my_photos"');
      console.log('   node local-bulk-upload.js "C:/Users/Ян/Pictures"');
      rl.close();
      process.exit(1);
    }
    

    const dbCheck = await checkDatabaseConnection();
    if (!dbCheck.connected) {
      rl.close();
      process.exit(1);
    }
    
    console.log(`\n Папка для загрузки: ${folderPath}`);
    console.log(` Фото в БД сейчас: ${dbCheck.count}`);
    

    console.log('\n РЕЖИМЫ ЗАГРУЗКИ:');
    console.log('1. Добавить новые фото (пропустить дубликаты)');
    console.log('2. Очистить и загрузить заново (удалит все существующие фото)');
    console.log('3. Отмена');
    
    const choice = await askQuestion('\n Выберите режим (1, 2 или 3): ');
    
    if (choice === '3') {
      console.log(' Отменено пользователем');
      rl.close();
      return;
    }
    
    if (choice !== '1' && choice !== '2') {
      console.log(' Неверный выбор');
      rl.close();
      return;
    }
    
    const clearExisting = (choice === '2');
    
    if (clearExisting) {
      console.log('\n  ВНИМАНИЕ!');
      console.log('Вы выбрали режим "Очистить и загрузить заново".');
      console.log(`Это удалит ВСЕ ${dbCheck.count} существующих фото из БД!`);
      
      const confirm = await askQuestion('\n Вы уверены? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
        console.log(' Отменено пользователем');
        rl.close();
        return;
      }
    }
    

    await processUpload(folderPath, clearExisting);
    
    console.log('\n Загрузка завершена!');
    console.log('\n Проверьте результат:');
    console.log('    Локальный API: http://localhost:3000/api/photos');
    
  } catch (error) {
    console.error('\n Неожиданная ошибка:', error.message);
  } finally {
    rl.close();
  }
}

// Запуск
if (require.main === module) {
  main().catch(console.error);
}