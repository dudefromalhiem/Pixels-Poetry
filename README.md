# AlHiemCreator

Static `html/css/js` implementation of the ALHIEM industrial portfolio and intake system.

## Files

- `index.html`: main site entry point for GitHub Pages
- `style.css`: full visual system and responsive styling
- `app.js`: Firebase Auth, Firestore, Storage, EmailJS, request form, owner dashboard
- `config.js`: runtime placeholders for Firebase and EmailJS keys
- `firestore.rules`: request collection security rules
- `storage.rules`: upload rules

## Runtime Setup

Replace the placeholder values in `config.js` with your real Firebase and EmailJS credentials.

### Firebase

The site expects:

- Authentication
- Firestore
- Storage

### EmailJS

Fill:

- `serviceId`
- `templateId`
- `publicKey`

## Owner Access

Only this account should see the dashboard:

`dudefromalhiem@gmail.com`

## Firestore Collection

The form writes to:

`website_requests`

Each document contains exactly:

- `name`
- `email`
- `websiteName`
- `description`
- `theme`
- `colorPreferences`
- `fontPreferences`
- `dataToDisplay`
- `websitePurpose`
- `type`
- `maintenancePlan`
- `additionalRequirements`
- `fileUrls`
- `createdAt`
