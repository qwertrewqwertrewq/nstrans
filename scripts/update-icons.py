import base64
from PIL import Image

def main():
    print("Reading logo_NSTrans.png...")
    logo = Image.open('logo_NSTrans.png')
    print("Size:", logo.size, "Mode:", logo.mode)

    # 1. 1024x1024 for Tauri icon generator
    logo_1024 = logo.resize((1024, 1024), Image.Resampling.LANCZOS)
    logo_1024.save('app-icon.png')

    # 2. Public folder assets
    logo.save('public/logo.png')
    logo.resize((64, 64), Image.Resampling.LANCZOS).save('public/favicon.png')
    logo.resize((32, 32), Image.Resampling.LANCZOS).save('public/favicon.ico')

    # 3. SVG embedding PNG base64 for fallback
    with open('logo_NSTrans.png', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">\n  <image width="500" height="500" href="data:image/png;base64,{b64}"/>\n</svg>\n'
    with open('public/favicon.svg', 'w', encoding='utf-8') as f:
        f.write(svg)

    print("Successfully generated all web and base assets.")

if __name__ == '__main__':
    main()
