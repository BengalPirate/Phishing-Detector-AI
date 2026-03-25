# Extension Icons

This directory contains the icons for the Phishing Detector AI browser extension.

## Creating Icons

To create the extension icons, you have two options:

### Option 1: Use the Python Script (Recommended)

1. Install Pillow:
   ```bash
   pip install pillow
   ```

2. Run the icon creation script:
   ```bash
   python create_icons.py
   ```

This will create all required icon sizes (16x16, 32x32, 48x48, 128x128).

### Option 2: Create Manually

You can create the icons manually using any image editing software (GIMP, Photoshop, etc.):

Required sizes:
- icon16.png (16x16 pixels)
- icon32.png (32x32 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

Design suggestion:
- Use a shield icon to represent security
- Add a checkmark or AI symbol
- Use blue colors to match the extension theme
- Ensure icons are clear at small sizes

## Temporary Solution

If you don't want to create icons right now, you can use placeholder colored squares:
- The extension will still work without custom icons
- Chrome/Firefox will show default extension icons instead
