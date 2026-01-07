#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

console.log(`
╔══════════════════════════════════════════════════╗
║           СИНХРОНИЗАЦИЯ БД                       ║
║           Локальная БД → Render БД               ║
╚══════════════════════════════════════════════════╝
`);

const LOCAL_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'photo_gallery',
  user: 'postgres',        
  password: '1812' 
};


async function syncDatabases() {
  try {
    console.log('1. Получаю настройки Render БД...');
    
    let RENDER_URL = '';
    try {
      const envContent = fs.readFileSync('.env.production', 'utf8');
      const match = envContent.match(/DATABASE_URL=(.+)/);
      if (match) {
        RENDER_URL = match[1].trim();
        const maskedUrl = RENDER_URL.replace(/:[^:@]+@/, ':****@');
        console.log(`   Найден: ${maskedUrl}`);
      } else {
        throw new Error('Не найден DATABASE_URL');
      }
    } catch (error) {
      console.log('Ошибка чтения .env.production:', error.message);
      console.log('Создайте файл .env.production с содержимым:');
      console.log('DATABASE_URL=postgresql://gallery_app:пароль@хост:5432/база');
      return;
    }
    
    console.log('\n2. Подключаюсь к локальной БД...');
    console.log(`   Пользователь: ${LOCAL_CONFIG.user}`);
    
    const localPool = new Pool(LOCAL_CONFIG);
    let localClient;
    
    try {
      localClient = await localPool.connect();
      console.log('   Локальная БД подключена');
    } catch (error) {
      console.log(`   Ошибка подключения: ${error.message}`);
      console.log('\n Советы:');
      console.log('1. Проверьте пароль в LOCAL_CONFIG');
      console.log('2. Проверьте запущен ли PostgreSQL');
      console.log('3. Проверьте имя пользователя');
      return;
    }
    
    console.log('\n3. Получаю фото из локальной БД...');
    
    let localPhotos;
    try {
      const result = await localClient.query(`
        SELECT id, filename, image_data, mime_type, file_size, 
               width, height, created_at, updated_at, description, tags
        FROM photos
        ORDER BY id
      `);
      localPhotos = result.rows;
      console.log(`   Найдено: ${localPhotos.length} фото`);
    } catch (error) {
      console.log(`   Ошибка запроса: ${error.message}`);
      console.log('   Проверьте существует ли таблица photos');
      localClient.release();
      await localPool.end();
      return;
    }
    
    if (localPhotos.length === 0) {
      console.log('    Нет фото для синхронизации');
      localClient.release();
      await localPool.end();
      return;
    }
    
    console.log('\n4. Подключаюсь к Render БД...');
    
    const renderPool = new Pool({
      connectionString: RENDER_URL,
      ssl: { rejectUnauthorized: false },
    });
    
    let renderClient;
    try {
      renderClient = await renderPool.connect();
      console.log('    Render БД подключена');
    } catch (error) {
      console.log(`    Ошибка подключения к Render: ${error.message}`);
      console.log('   Проверьте DATABASE_URL в .env.production');
      localClient.release();
      await localPool.end();
      return;
    }
    
    console.log('\n5. Проверяю текущие данные в Render...');
    
    let existingCount = 0;
    try {
      const countResult = await renderClient.query('SELECT COUNT(*) as count FROM photos');
      existingCount = parseInt(countResult.rows[0].count);
      console.log(`    Сейчас в Render: ${existingCount} фото`);
    } catch (error) {
      console.log(`     Не удалось проверить: ${error.message}`);
    }
    

    console.log('\n6. Выбор режима синхронизации:');
    console.log('   1. Очистить и заменить (удалит все существующие фото)');
    console.log('   2. Добавить к существующим (только новые фото)');
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const mode = await new Promise(resolve => {
      rl.question('   Выберите (1 или 2): ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    if (mode === '1') {
      console.log('    Очищаю таблицу в Render...');
      try {
        await renderClient.query('TRUNCATE photos RESTART IDENTITY CASCADE');
      } catch (error) {
        console.log(`     Не удалось очистить: ${error.message}`);
      }
    } else if (mode !== '2') {
      console.log('    Неверный выбор, отмена.');
      localClient.release();
      renderClient.release();
      await localPool.end();
      await renderPool.end();
      return;
    }
    

    console.log('\n7. Переношу данные...\n');
    
    let transferred = 0;
    let skipped = 0;
    let errors = 0;
    
    for (let i = 0; i < localPhotos.length; i++) {
      const photo = localPhotos[i];
      
      try {
        if (mode === '2') {
          const duplicateCheck = await renderClient.query(
            'SELECT 1 FROM photos WHERE filename = $1 AND file_size = $2 LIMIT 1',
            [photo.filename, photo.file_size]
          );
          
          if (duplicateCheck.rows.length > 0) {
            skipped++;
            continue;
          }
        }
        
        await renderClient.query(
          `INSERT INTO photos 
           (filename, image_data, mime_type, file_size, width, height,
            created_at, updated_at, description, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            photo.filename,
            photo.image_data,
            photo.mime_type || 'image/jpeg',
            photo.file_size,
            photo.width,
            photo.height,
            photo.created_at,
            photo.updated_at || photo.created_at,
            photo.description || '',
            photo.tags || []
          ]
        );
        
        transferred++;
        
        if ((i + 1) % 10 === 0 || (i + 1) === localPhotos.length) {
          const progress = ((i + 1) / localPhotos.length * 100).toFixed(1);
          process.stdout.write(`\r    Прогресс: ${i + 1}/${localPhotos.length} (${progress}%)`);
        }
        
      } catch (error) {
        console.log(`\n    Ошибка с "${photo.filename}": ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n');
    
    console.log('\n8. Проверяю результат...');
    
    try {
      const finalResult = await renderClient.query('SELECT COUNT(*) as count FROM photos');
      const finalCount = parseInt(finalResult.rows[0].count);
      
      console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║            РЕЗУЛЬТАТЫ СИНХРОНИЗАЦИИ            			║
╠═══════════════════════════════════════════════════════════════════════╣
║ Локальная БД:        ${localPhotos.length.toString().padEnd(6)} фото  ║
║ Перенесено:          ${transferred.toString().padEnd(6)} фото  	║
║ Пропущено (дубли):   ${skipped.toString().padEnd(6)} фото  		║
║ Ошибок:              ${errors.toString().padEnd(6)} фото  		║
║ Итог в Render:       ${finalCount.toString().padEnd(6)} фото  	║
╚═══════════════════════════════════════════════════════════════════════╝
      `);
      
    } catch (error) {
      console.log(`     Не удалось проверить результат: ${error.message}`);
    }
    

    console.log('\n9. Завершение...');
    localClient.release();
    renderClient.release();
    await localPool.end();
    await renderPool.end();
    
    console.log('\n Синхронизация завершена!');
    console.log('\n Проверьте результат:');
    console.log('    Render API: https://photo-gallery-api.onrender.com/api/photos');
    console.log('    Локальный API: http://localhost:3000/api/photos');
    
  } catch (error) {
    console.error('\n Неожиданная ошибка:', error.message);
    console.error(error.stack);
  }
}

syncDatabases().catch(console.error);