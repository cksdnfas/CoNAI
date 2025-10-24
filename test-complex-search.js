/**
 * Complex Search API Test Script
 * Tests the PoE-style AND/OR/NOT filtering system
 */

const API_BASE = 'http://localhost:1566/api';

// Test scenarios
const tests = [
  {
    name: 'Test 1: Simple Search Mode',
    description: 'Search for "girl" in prompt and auto_tags',
    payload: {
      simple_search: {
        text: 'girl'
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 2: Complex Filter - OR Group Only',
    description: 'Search for images with "1girl" OR "2girls" tag',
    payload: {
      complex_filter: {
        or_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: '1girl',
            min_score: 0.7
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: '2girls',
            min_score: 0.7
          }
        ]
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 3: Complex Filter - AND Group Only',
    description: 'Search for images with character AND high rating',
    payload: {
      complex_filter: {
        and_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_has_character',
            value: true
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_rating',
            value: 'general',
            rating_type: 'general',
            min_score: 0.8
          }
        ]
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 4: Complex Filter - Exclude Group',
    description: 'Exclude images with "nsfw" tag',
    payload: {
      complex_filter: {
        exclude_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: 'nsfw'
          }
        ],
        or_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: '1girl'
          }
        ]
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 5: Complex Filter - All Groups Combined',
    description: 'Exclude nsfw, (1girl OR 2girls), AND has character',
    payload: {
      complex_filter: {
        exclude_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: 'nsfw'
          }
        ],
        or_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: '1girl',
            min_score: 0.7
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: '2girls',
            min_score: 0.7
          }
        ],
        and_group: [
          {
            category: 'auto_tag',
            type: 'auto_tag_has_character',
            value: true
          }
        ]
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 6: Prompt-based Filter',
    description: 'Search in positive and negative prompts',
    payload: {
      complex_filter: {
        or_group: [
          {
            category: 'positive_prompt',
            type: 'prompt_contains',
            value: 'masterpiece'
          },
          {
            category: 'positive_prompt',
            type: 'prompt_contains',
            value: 'best quality'
          }
        ]
      },
      page: 1,
      limit: 5
    }
  },
  {
    name: 'Test 7: Validation Test - Invalid Filter',
    description: 'Test validation endpoint with invalid filter',
    endpoint: '/validate',
    payload: {
      or_group: [
        {
          category: 'auto_tag',
          type: 'auto_tag_rating',
          value: 'general',
          // Missing rating_type - should fail validation
          min_score: 0.8
        }
      ]
    }
  }
];

async function runTest(test) {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 ${test.name}`);
  console.log(`   ${test.description}`);
  console.log('='.repeat(80));

  const endpoint = test.endpoint || '';
  const url = `${API_BASE}/images/search/complex${endpoint}`;

  console.log(`\n📤 Request:`);
  console.log(`   POST ${url}`);
  console.log(`   Body: ${JSON.stringify(test.payload, null, 2)}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(test.payload)
    });

    const data = await response.json();

    console.log(`\n📥 Response (${response.status}):`);

    if (data.success) {
      console.log(`   ✅ Success`);
      if (data.data.images) {
        console.log(`   📊 Results: ${data.data.total} total, showing ${data.data.images.length} images`);
        if (data.data.images.length > 0) {
          console.log(`\n   Sample Image:`);
          const sample = data.data.images[0];
          console.log(`   - ID: ${sample.id}`);
          console.log(`   - Filename: ${sample.filename}`);
          console.log(`   - Upload Date: ${sample.upload_date}`);
          if (sample.auto_tags) {
            try {
              const tags = JSON.parse(sample.auto_tags);
              console.log(`   - Has AutoTags: Yes`);
              console.log(`   - Model: ${tags.model || 'N/A'}`);
              if (tags.general) {
                const topTags = Object.entries(tags.general)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([tag, score]) => `${tag}(${score.toFixed(2)})`)
                  .join(', ');
                console.log(`   - Top Tags: ${topTags}`);
              }
            } catch (e) {
              console.log(`   - AutoTags: Parse error`);
            }
          } else {
            console.log(`   - Has AutoTags: No`);
          }
        }
      } else if (data.data.valid !== undefined) {
        // Validation response
        console.log(`   Validation Result: ${data.data.valid ? '✅ Valid' : '❌ Invalid'}`);
        if (data.data.errors && data.data.errors.length > 0) {
          console.log(`   Errors:`);
          data.data.errors.forEach(err => console.log(`   - ${err}`));
        }
      }
    } else {
      console.log(`   ❌ Failed`);
      console.log(`   Error: ${data.error}`);
    }

  } catch (error) {
    console.log(`\n❌ Request Failed:`);
    console.log(`   ${error.message}`);
  }
}

async function runAllTests() {
  console.log('\n' + '█'.repeat(80));
  console.log('  Complex Search API Test Suite');
  console.log('  PoE-style AND/OR/NOT Filtering System');
  console.log('█'.repeat(80));

  // Check if server is running
  console.log('\n🔍 Checking server status...');
  try {
    const response = await fetch(`${API_BASE}/images?page=1&limit=1`);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    console.log('   ✅ Server is running');
  } catch (error) {
    console.log('   ❌ Server is not running or not accessible');
    console.log(`   Error: ${error.message}`);
    console.log('\n   Please start the backend server first:');
    console.log('   npm run dev:backend');
    return;
  }

  // Run all tests
  for (const test of tests) {
    await runTest(test);
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '█'.repeat(80));
  console.log('  Test Suite Completed');
  console.log('█'.repeat(80) + '\n');
}

// Run tests
runAllTests();
