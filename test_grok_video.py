"""
Test script for Grok Video Generation API
Run: python test_grok_video.py
"""

import os
import time
import requests
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

# Configuration
XAI_API_KEY = os.getenv('VITE_GROK_API_KEY')
XAI_API_BASE = "https://api.x.ai/v1"
MODEL = "grok-imagine-video"

# Test image URL (use a public image)
TEST_IMAGE_URL = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400"

def get_headers():
    return {
        "Authorization": f"Bearer {XAI_API_KEY}",
        "Content-Type": "application/json",
    }

def start_video_generation(prompt: str, image_url: str = None):
    """Start video generation and return request_id"""
    url = f"{XAI_API_BASE}/videos/generations"

    payload = {
        "model": MODEL,
        "prompt": prompt,
        "duration": 5,  # 5 seconds
        "aspect_ratio": "9:16",  # Portrait
        "resolution": "720p",
    }

    if image_url:
        payload["image"] = {"url": image_url}

    print(f"\n🎬 Starting video generation...")
    print(f"   URL: {url}")
    print(f"   Model: {MODEL}")
    print(f"   Prompt: {prompt[:50]}...")
    if image_url:
        print(f"   Image URL: {image_url[:50]}...")

    response = requests.post(url, headers=get_headers(), json=payload)

    print(f"\n📡 Response Status: {response.status_code}")
    print(f"📡 Response Body: {response.text}")

    if response.status_code == 200 or response.status_code == 202:
        return response.json()
    else:
        print(f"\n❌ Error: {response.status_code}")
        print(response.json())
        return None

def poll_for_result(request_id: str, max_wait: int = 300, poll_interval: int = 10):
    """Poll until video is ready"""
    # Try /videos/{id} instead of /videos/generations/{id}
    url = f"{XAI_API_BASE}/videos/{request_id}"

    print(f"\n⏳ Polling for result (request_id: {request_id})...")

    start_time = time.time()
    while time.time() - start_time < max_wait:
        response = requests.get(url, headers=get_headers())

        # 200 = completed, 202 = still processing
        if response.status_code not in (200, 202):
            print(f"❌ Poll error: {response.status_code}")
            print(response.text)
            return None

        result = response.json()
        status = result.get("status")

        elapsed = int(time.time() - start_time)
        print(f"   [{elapsed}s] Status: {status}")

        if status == "completed":
            print(f"\n✅ Video ready!")
            print(f"   URL: {result.get('url')}")
            return result
        elif status == "failed":
            print(f"\n❌ Video generation failed: {result.get('error')}")
            return result

        time.sleep(poll_interval)

    print(f"\n⏰ Timeout after {max_wait} seconds")
    return None

def test_text_to_video():
    """Test text-to-video generation"""
    print("\n" + "="*60)
    print("TEST 1: Text-to-Video")
    print("="*60)

    prompt = "A young woman with curly hair waves at the camera and smiles warmly. She is sitting on a cozy couch. Soft natural lighting."

    result = start_video_generation(prompt)

    if result and result.get("request_id"):
        final = poll_for_result(result["request_id"])
        return final
    return None

def test_image_to_video():
    """Test image-to-video generation"""
    print("\n" + "="*60)
    print("TEST 2: Image-to-Video")
    print("="*60)

    prompt = "The woman slowly smiles and waves at the camera. Gentle movement, natural and warm."

    result = start_video_generation(prompt, image_url=TEST_IMAGE_URL)

    if result and result.get("request_id"):
        final = poll_for_result(result["request_id"])
        return final
    return None

def main():
    print("="*60)
    print("Grok Video Generation API Test")
    print("="*60)

    if not XAI_API_KEY:
        print("\n❌ ERROR: VITE_GROK_API_KEY not found in .env.local")
        print("   Make sure your .env.local file contains:")
        print("   VITE_GROK_API_KEY=your_api_key_here")
        return

    print(f"\n✅ API Key found: {XAI_API_KEY[:10]}...{XAI_API_KEY[-4:]}")

    # Test 1: Text-to-video (no reference image)
    # test_text_to_video()

    # Uncomment to also test image-to-video:
    test_image_to_video()

if __name__ == "__main__":
    main()
