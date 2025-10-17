# ComfyUI Image Manager - API Documentation

## Base URL
```
http://localhost:1566/api
```

## Authentication
Currently, no authentication is required. This is suitable for local/personal use.
**Future Enhancement**: Add API key or JWT authentication for external access.

---

## 📸 Images API

### Upload Image
Upload a new image with optional AI metadata.

**Endpoint:** `POST /api/images/upload`

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `image` (file, required): Image file
  - `group_id` (number, optional): Assign to group
  - `tags` (string, optional): Comma-separated tags
  - AI metadata fields (all optional):
    - `prompt` (string)
    - `negative_prompt` (string)
    - `steps` (number)
    - `cfg_scale` (number)
    - `sampler` (string)
    - `model` (string)
    - `seed` (number)
    - `ai_tool` (string): e.g., "ComfyUI", "NovelAI", "Stable Diffusion"

**Response:** `200 OK`
```json
{
  "id": 1,
  "filename": "image.png",
  "path": "2025-10-10/uuid.png",
  "thumbnail_path": "2025-10-10/uuid_thumb.png",
  "optimized_path": "2025-10-10/uuid_opt.webp",
  "width": 1024,
  "height": 1024,
  "file_size": 2048576,
  "format": "png",
  "prompt": "beautiful landscape",
  "created_at": "2025-10-10T12:00:00.000Z"
}
```

### Get All Images
Retrieve all images with pagination.

**Endpoint:** `GET /api/images`

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 50, max: 100)
- `sort` (string, default: "created_at"): Sort field
- `order` (string, default: "desc"): "asc" or "desc"

**Response:** `200 OK`
```json
{
  "images": [...],
  "pagination": {
    "current_page": 1,
    "total_pages": 10,
    "total_count": 500,
    "per_page": 50
  }
}
```

### Get Image by ID
**Endpoint:** `GET /api/images/:id`

**Response:** `200 OK` - Single image object

### Search Images
**Endpoint:** `GET /api/images/search`

**Query Parameters:**
- `query` (string): Search in filename, prompt, tags
- `ai_tool` (string): Filter by AI tool
- `model` (string): Filter by model
- `group_id` (number): Filter by group
- `start_date` (string): ISO date
- `end_date` (string): ISO date

**Response:** `200 OK` - Array of matching images

### Update Image
**Endpoint:** `PUT /api/images/:id`

**Request Body:**
```json
{
  "prompt": "updated prompt",
  "negative_prompt": "updated negative",
  "tags": "tag1,tag2,tag3"
}
```

**Response:** `200 OK` - Updated image object

### Delete Image
**Endpoint:** `DELETE /api/images/:id`

**Response:** `200 OK`
```json
{
  "message": "Image deleted successfully"
}
```

### Download Image
**Endpoint:** `GET /api/images/:id/download`

**Query Parameters:**
- `version` (string, optional): "original", "thumbnail", "optimized" (default: "original")

**Response:** Image file with proper headers

---

## 📁 Groups API

### Create Group
**Endpoint:** `POST /api/groups`

**Request Body:**
```json
{
  "name": "My Collection",
  "description": "Description here",
  "auto_collect": true,
  "auto_collect_conditions": [
    {
      "field": "prompt",
      "operator": "contains",
      "value": "landscape",
      "case_sensitive": false
    }
  ]
}
```

**Response:** `201 Created` - Created group object

### Get All Groups
**Endpoint:** `GET /api/groups`

**Response:** `200 OK` - Array of groups with image counts

### Get Group by ID
**Endpoint:** `GET /api/groups/:id`

**Response:** `200 OK` - Group object with images

### Update Group
**Endpoint:** `PUT /api/groups/:id`

**Response:** `200 OK` - Updated group object

### Delete Group
**Endpoint:** `DELETE /api/groups/:id`

**Response:** `200 OK`

### Add Image to Group
**Endpoint:** `POST /api/groups/:id/images`

**Request Body:**
```json
{
  "image_id": 123
}
```

**Response:** `200 OK`

### Remove Image from Group
**Endpoint:** `DELETE /api/groups/:id/images/:imageId`

**Response:** `200 OK`

### Trigger Auto-Collection
**Endpoint:** `POST /api/groups/:id/auto-collect`

**Response:** `200 OK`
```json
{
  "added_count": 15,
  "message": "Auto-collection completed"
}
```

---

## 🏷️ Prompt Collection API

### Get Prompt Statistics
**Endpoint:** `GET /api/prompt-collection`

**Query Parameters:**
- `type` (string): "positive" or "negative"
- `limit` (number, default: 100)

**Response:** `200 OK`
```json
{
  "prompts": [
    {
      "id": 1,
      "prompt": "beautiful landscape",
      "count": 42,
      "avg_steps": 30,
      "avg_cfg_scale": 7.5,
      "first_seen": "2025-01-01T00:00:00.000Z",
      "last_seen": "2025-10-10T00:00:00.000Z"
    }
  ],
  "total": 250
}
```

### Search Prompts
**Endpoint:** `GET /api/prompt-collection/search`

**Query Parameters:**
- `query` (string): Search term
- `type` (string): "positive" or "negative"

**Response:** `200 OK` - Array of matching prompts

### Merge Synonyms
**Endpoint:** `POST /api/prompt-collection/merge`

**Request Body:**
```json
{
  "primary_id": 1,
  "synonym_ids": [2, 3, 4]
}
```

**Response:** `200 OK`

---

## 🎨 ComfyUI Integration API (Future)

### Send to ComfyUI
**Endpoint:** `POST /api/comfyui/generate`

**Request Body:**
```json
{
  "prompt": "beautiful landscape",
  "negative_prompt": "ugly, blurry",
  "steps": 30,
  "cfg_scale": 7.5,
  "sampler": "euler_a",
  "model": "sd_xl_base_1.0",
  "seed": -1,
  "width": 1024,
  "height": 1024,
  "workflow": null
}
```

**Response:** `202 Accepted`
```json
{
  "job_id": "uuid",
  "status": "queued",
  "message": "Generation request sent to ComfyUI"
}
```

### Get Generation Status
**Endpoint:** `GET /api/comfyui/status/:jobId`

**Response:** `200 OK`
```json
{
  "job_id": "uuid",
  "status": "completed",
  "progress": 100,
  "image_id": 123,
  "error": null
}
```

### Get ComfyUI Connection Status
**Endpoint:** `GET /api/comfyui/connection`

**Response:** `200 OK`
```json
{
  "connected": true,
  "server_url": "http://localhost:8188",
  "version": "1.0.0"
}
```

---

## 📊 Health Check

### Health Check
**Endpoint:** `GET /health`

**Response:** `200 OK`
```json
{
  "status": "OK",
  "timestamp": "2025-10-10T12:00:00.000Z",
  "uptime": 3600
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "details": "Additional details (optional)"
}
```

**Common Status Codes:**
- `200 OK`: Success
- `201 Created`: Resource created
- `202 Accepted`: Request accepted (async operation)
- `400 Bad Request`: Invalid input
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

---

## Rate Limiting

Current limit: 1000 requests per minute (development setting)

Production recommendation: 100 requests per minute per IP

---

## CORS

Currently allows all origins for local development.

For production/external access, configure `ALLOWED_ORIGINS` environment variable:
```
ALLOWED_ORIGINS=https://yourdomain.com,https://anotherdomain.com
```

---

## WebSocket API (Future Enhancement)

Real-time updates for:
- Image upload progress
- ComfyUI generation progress
- Auto-collection triggers
- System notifications

**Endpoint:** `ws://localhost:1566/ws`

---

## SDK Examples

### JavaScript/Node.js
```javascript
const apiUrl = 'http://localhost:1566/api';

// Upload image
async function uploadImage(file, metadata) {
  const formData = new FormData();
  formData.append('image', file);
  Object.entries(metadata).forEach(([key, value]) => {
    formData.append(key, value);
  });

  const response = await fetch(`${apiUrl}/images/upload`, {
    method: 'POST',
    body: formData
  });

  return response.json();
}

// Search images
async function searchImages(query) {
  const response = await fetch(
    `${apiUrl}/images/search?query=${encodeURIComponent(query)}`
  );
  return response.json();
}
```

### Python
```python
import requests

API_URL = 'http://localhost:1566/api'

# Upload image
def upload_image(filepath, metadata=None):
    with open(filepath, 'rb') as f:
        files = {'image': f}
        data = metadata or {}
        response = requests.post(f'{API_URL}/images/upload',
                                files=files, data=data)
        return response.json()

# Search images
def search_images(query):
    response = requests.get(f'{API_URL}/images/search',
                           params={'query': query})
    return response.json()
```

---

## Next Steps

1. **Implement ComfyUI Integration**
   - WebSocket connection to ComfyUI server
   - Workflow execution
   - Progress tracking
   - Result retrieval and auto-import

2. **Add Authentication**
   - API key generation
   - JWT tokens
   - Rate limiting per user

3. **Implement WebSocket**
   - Real-time updates
   - Progress notifications

4. **Add Batch Operations**
   - Bulk upload
   - Bulk tag/group assignment
   - Bulk export

5. **External Storage Integration**
   - S3-compatible storage
   - Cloud storage options
