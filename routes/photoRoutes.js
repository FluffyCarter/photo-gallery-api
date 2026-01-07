const express = require('express');
const router = express.Router();
const photoController = require('../controllers/photoController');
const bulkUploadController = require('../controllers/bulkUploadController');
const upload = require('../middleware/uploadMiddleware');

router.post('/upload', upload.single('image'), photoController.uploadPhoto);

router.post('/bulk-upload', bulkUploadController.uploadFromFolder);

router.get('/', photoController.getPhotos);
router.get('/search', photoController.searchByTags);
router.get('/:id', photoController.getPhoto);
router.get('/:id/image', photoController.getImage);
router.put('/:id', photoController.updatePhoto);
router.get('/:id/image-fresh', photoController.getImageNoCache);
router.delete('/:id', photoController.deletePhoto);

module.exports = router;