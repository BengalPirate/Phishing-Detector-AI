"""
Simple script to create placeholder icons for the browser extension.
Run this with: python create_icons.py
Requires: pip install pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, filename):
    """Create a simple icon with a shield and checkmark."""
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colors
    bg_color = (26, 115, 232)  # Blue
    shield_color = (255, 255, 255)  # White

    # Draw background circle
    margin = size // 10
    draw.ellipse([margin, margin, size-margin, size-margin], fill=bg_color)

    # Draw shield shape (simplified)
    shield_margin = size // 4
    shield_width = size - (shield_margin * 2)
    shield_height = shield_width

    # Shield points
    top = shield_margin
    bottom = size - shield_margin
    left = shield_margin
    right = size - shield_margin
    center_x = size // 2

    # Draw shield
    points = [
        (center_x, top),
        (right, top + shield_height // 3),
        (right, bottom - shield_height // 4),
        (center_x, bottom),
        (left, bottom - shield_height // 4),
        (left, top + shield_height // 3)
    ]
    draw.polygon(points, fill=shield_color)

    # Draw checkmark
    check_color = bg_color
    check_width = max(2, size // 20)

    # Checkmark points (simplified)
    check_start_x = size // 3
    check_mid_x = size // 2.2
    check_end_x = size * 2 // 3

    check_start_y = size // 2
    check_mid_y = size * 3 // 5
    check_end_y = size // 2.5

    draw.line([(check_start_x, check_start_y), (check_mid_x, check_mid_y)],
              fill=check_color, width=check_width)
    draw.line([(check_mid_x, check_mid_y), (check_end_x, check_end_y)],
              fill=check_color, width=check_width)

    # Save the image
    img.save(filename, 'PNG')
    print(f"Created {filename}")

def main():
    """Create all required icon sizes."""
    script_dir = os.path.dirname(os.path.abspath(__file__))

    sizes = [16, 32, 48, 128]

    for size in sizes:
        filename = os.path.join(script_dir, f'icon{size}.png')
        create_icon(size, filename)

    print("\nAll icons created successfully!")
    print("Icons are located in:", script_dir)

if __name__ == '__main__':
    try:
        main()
    except ImportError:
        print("Error: Pillow library not found.")
        print("Please install it with: pip install pillow")
    except Exception as e:
        print(f"Error creating icons: {e}")
