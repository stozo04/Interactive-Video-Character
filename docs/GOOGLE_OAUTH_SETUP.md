# Google OAuth Setup Guide

This guide will help you set up Google OAuth authentication for the Interactive Video Character application.

## Prerequisites

- A Google account
- Access to Google Cloud Console

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top of the page
3. Click "New Project"
4. Enter a project name (e.g., "Interactive Video Character")
5. Click "Create"

## Step 2: Enable Gmail API

1. In your Google Cloud project, go to "APIs & Services" > "Library"
2. Search for "Gmail API"
3. Click on "Gmail API"
4. Click "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type (unless you have a Google Workspace)
3. Click "Create"
4. Fill in the required fields:
   - **App name**: Interactive Video Character
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
5. Click "Save and Continue"
6. On the "Scopes" page, click "Add or Remove Scopes"
7. Add the following scope:
   - `https://www.googleapis.com/auth/gmail.metadata` (Read email metadata)
8. Click "Update" and then "Save and Continue"
9. On the "Test users" page, add your email address if you're testing
10. Click "Save and Continue"
11. Review and click "Back to Dashboard"

## Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Web application" as the application type
4. Enter a name (e.g., "Interactive Video Character Web Client")
5. Under "Authorized JavaScript origins", add:
   - `http://localhost:5173` (for development)
   - Your production domain (when deployed)
6. Under "Authorized redirect URIs", you can leave this empty for client-side OAuth
7. Click "Create"
8. Copy your **Client ID** (it will look like: `xxxxx.apps.googleusercontent.com`)

## Step 5: Configure Your Application

1. Create a `.env` file in the root of your project (if it doesn't exist)
2. Add your Google Client ID:

```env
VITE_GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
```

3. Replace `your_client_id_here` with the Client ID you copied in Step 4

## Step 6: Test the Integration

1. Start your development server:
```bash
npm run dev
```

2. Open your browser to `http://localhost:5173`
3. Click the Settings icon (⚙️) in the top-right corner
4. Click "Connect with Google"
5. You should see a Google sign-in popup
6. Select your Google account and grant permissions
7. You should see "Connected as [your email]"

## Troubleshooting

### "Popup blocked" error
- Allow popups for your application in your browser settings
- Try clicking the "Connect with Google" button again

### "Google Client ID is not configured" error
- Make sure your `.env` file exists in the root directory
- Verify that the variable is named exactly `VITE_GOOGLE_CLIENT_ID`
- Restart your development server after creating/modifying the `.env` file

### "Failed to load Google Identity Services script" error
- Check your internet connection
- Verify that you're not blocking Google scripts in your browser
- Try clearing your browser cache

### "Authentication failed" error
- Verify your Client ID is correct
- Make sure you've added your domain to "Authorized JavaScript origins"
- Check the browser console for more detailed error messages

## Security Best Practices

1. **Never commit your `.env` file to version control**
   - The `.env` file is already in `.gitignore`
   - Only commit `.env.example` with placeholder values

2. **Use different Client IDs for development and production**
   - Create separate OAuth clients for each environment
   - Restrict JavaScript origins appropriately

3. **Regularly review OAuth consent screen and permissions**
   - Only request the minimum scopes necessary
   - Currently using `gmail.metadata` (read-only email headers)

4. **Monitor usage in Google Cloud Console**
   - Check for unusual activity
   - Review API quotas and usage

## Features of This Implementation

### Standalone OAuth Flow
- Uses Google Identity Services (GIS) library directly in the browser
- No backend server required for authentication
- Tokens are managed securely in localStorage with expiry checks

### Automatic Token Refresh
- Tokens are automatically refreshed before expiry
- Configurable refresh interval (default: 60 seconds check)
- Seamless user experience without re-authentication

### Session Management
- Persistent sessions across page reloads
- Automatic session validation on app startup
- Clean sign-out with token revocation

### Error Handling
- User-friendly error messages
- Automatic recovery from expired sessions
- Popup blocker detection

## API Scopes

This application uses the following Gmail scopes:

- `https://www.googleapis.com/auth/gmail.metadata` - Read email metadata (headers, subject, sender)
  - This is a restricted scope that does NOT allow reading email content
  - Only metadata like subject, sender, and date are accessible
  - More privacy-friendly than full Gmail access

## Gmail Integration Features

Once connected, the application can:
- Monitor for new emails (via Gmail API)
- Read email headers (subject, sender, date)
- Display notifications for new messages
- Poll for changes using Gmail history API

The application does NOT:
- Read email content/body
- Send emails
- Delete or modify emails
- Access contacts or other Google services

## Additional Resources

- [Google Identity Services Documentation](https://developers.google.com/identity/gsi/web)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [OAuth 2.0 for Client-side Applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)

## Support

If you encounter any issues:
1. Check the browser console for detailed error messages
2. Review the troubleshooting section above
3. Verify all setup steps were completed correctly
4. Check that your Google Cloud project settings are correct

