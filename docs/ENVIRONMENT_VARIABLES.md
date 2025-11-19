# Environment Variables Configuration

This document describes all environment variables used in the Interactive Video Character application.

## Creating Your .env File

Create a `.env` file in the root directory of the project with the following content:

```env
# ============================================
# Supabase Configuration (Required)
# ============================================
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# ============================================
# User Configuration (Required)
# ============================================
# Unique identifier for the user
# Can be any string (e.g., your name, email, or a custom ID)
VITE_USER_ID=your-user-id

# ============================================
# Google OAuth Configuration (Optional)
# ============================================
# Required for Gmail integration features
# Get your Client ID from: https://console.cloud.google.com/apis/credentials
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# ============================================
# Other API Keys (if applicable)
# ============================================
# Add any additional API keys your project needs here
```

## Variable Descriptions

### Required Variables

#### `VITE_SUPABASE_URL`
- **Description**: Your Supabase project URL
- **Format**: `https://your-project.supabase.co`
- **Where to find**: Supabase Dashboard → Settings → API
- **Example**: `https://abcdefghijklmnop.supabase.co`

#### `VITE_SUPABASE_ANON_KEY`
- **Description**: Your Supabase anonymous/public API key
- **Format**: Long base64-encoded string
- **Where to find**: Supabase Dashboard → Settings → API
- **Security**: Safe to use in client-side code (has Row Level Security)
- **Example**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

#### `VITE_USER_ID`
- **Description**: Unique identifier for the user (used for conversation history and relationship tracking)
- **Format**: Any string identifier
- **Where to find**: Choose your own (e.g., your name, email, username, or any unique identifier)
- **Purpose**: Distinguishes between different users in the database
- **Example**: `john_doe`, `user@example.com`, or `user_123`

### Optional Variables

#### `VITE_GOOGLE_CLIENT_ID`
- **Description**: Google OAuth 2.0 Client ID for Gmail integration
- **Format**: `[client-id].apps.googleusercontent.com`
- **Where to find**: Google Cloud Console → APIs & Services → Credentials
- **Required for**: Gmail integration, email notifications
- **Setup Guide**: See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
- **Example**: `123456789-abcdefg.apps.googleusercontent.com`

## Security Best Practices

### DO ✅

1. **Keep your `.env` file private**
   - Never commit it to version control
   - The `.gitignore` file already excludes `.env` files

2. **Use different values for different environments**
   - Development: Local Supabase or test project
   - Production: Production Supabase project

3. **Rotate keys regularly**
   - Regenerate API keys periodically
   - Update OAuth credentials if compromised

4. **Use environment-specific Client IDs**
   - Development: Client ID with `localhost` origins
   - Production: Client ID with your domain origins

### DON'T ❌

1. **Never expose your `.env` file contents**
   - Don't share in chat, email, or screenshots
   - Don't paste in public forums

2. **Don't hardcode sensitive values**
   - Always use environment variables
   - Never commit API keys in source code

3. **Don't use production keys in development**
   - Use separate projects/credentials for testing

## Troubleshooting

### "Environment variable not found" errors

**Problem**: Application can't find your environment variables

**Solutions**:
1. Verify `.env` file is in the root directory (same level as `package.json`)
2. Check variable names are spelled correctly (case-sensitive)
3. Ensure variables start with `VITE_` prefix (required for Vite)
4. Restart the development server after creating/modifying `.env`

```bash
# Stop the server (Ctrl+C)
# Start it again
npm run dev
```

### Variables not updating

**Problem**: Changes to `.env` file don't take effect

**Solution**: Restart the development server
```bash
# Stop with Ctrl+C, then restart
npm run dev
```

### Google Client ID not working

**Problem**: OAuth fails even with Client ID configured

**Checklist**:
1. ✅ Client ID is correctly copied (no extra spaces)
2. ✅ Variable is named `VITE_GOOGLE_CLIENT_ID`
3. ✅ Development server was restarted
4. ✅ JavaScript origins are configured in Google Cloud Console
5. ✅ OAuth consent screen is configured

See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) for detailed troubleshooting

## Production Deployment

### Vercel, Netlify, or Similar Platforms

1. Go to your project settings
2. Find "Environment Variables" or "Build Settings"
3. Add each variable from your `.env` file
4. Ensure you use production values (not development)
5. For Google OAuth: Update authorized origins to include your production domain

### Docker

Create a `.env.production` file with production values:

```dockerfile
# In your Dockerfile or docker-compose.yml
# Load environment variables from .env.production
```

### Manual Server Deployment

1. SSH into your server
2. Navigate to the application directory
3. Create a `.env` file with production values
4. Ensure file permissions are secure (readable only by the app user)

```bash
chmod 600 .env
chown appuser:appuser .env
```

## Validation

To verify your environment variables are loaded correctly:

1. Start the development server:
```bash
npm run dev
```

2. Open browser console (F12)
3. Check for configuration errors in the console
4. The app should load without "configuration missing" errors

## Example Complete Configuration

```env
# Supabase
VITE_SUPABASE_URL=https://xyz123.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5ejEyMyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE5MTU2NjAwMDB9.example

# User Configuration
VITE_USER_ID=john_doe

# Google OAuth (optional)
VITE_GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
```

## Additional Resources

- [Vite Environment Variables Documentation](https://vitejs.dev/guide/env-and-mode.html)
- [Supabase JavaScript Client Setup](https://supabase.com/docs/reference/javascript/introduction)
- [Google OAuth Setup Guide](./GOOGLE_OAUTH_SETUP.md)

## Getting Help

If you're still having issues with environment variables:

1. Check the console for specific error messages
2. Verify all required variables are set
3. Ensure the `.env` file is in the correct location
4. Try creating a fresh `.env` file from scratch
5. Restart your development server

For Google OAuth specific issues, see the [Troubleshooting section](./GOOGLE_OAUTH_SETUP.md#troubleshooting) in the OAuth setup guide.

