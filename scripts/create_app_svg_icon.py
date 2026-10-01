import os
import subprocess

def main():
    os.makedirs('resources', exist_ok=True)
    
    # App signature green: #06B46F (Emerald Green matching app's theme)
    # Piggy bank outline matching user's image: dark charcoal/black (#111827)
    
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Square background filling 100% full bleed with app emerald green -->
  <rect width="1024" height="1024" fill="#06B46F"/>
  
  <g fill="#06B46F" stroke="#111827" stroke-width="52" stroke-linecap="round" stroke-linejoin="round">
    <!-- Main Piggy Bank Body Path -->
    <!-- Tail on top-left, Ear on top, Snout on right, Legs at bottom -->
    <path d="
      M 240,430 
      C 220,380 180,350 170,410 
      C 160,460 210,490 235,510
      C 230,600 280,690 350,730
      L 350,830
      C 350,855 380,870 410,870
      C 440,870 470,855 470,830
      L 470,750
      L 580,750
      L 580,830
      C 580,855 610,870 640,870
      C 670,870 700,855 700,830
      L 700,730
      C 770,690 820,620 830,530
      L 860,530
      C 890,530 900,500 900,470
      C 900,440 890,410 860,410
      L 820,410
      C 790,290 680,210 540,210
      C 520,210 500,215 480,220
      L 490,150
      C 500,120 460,110 430,140
      L 350,230
      C 280,270 240,340 240,430
      Z
    " />
    
    <!-- Eye dot -->
    <circle cx="640" cy="410" r="32" fill="#111827" stroke="none" />
  </g>
</svg>
'''

    with open('resources/icon.svg', 'w') as f:
        f.write(svg_content)
        
    print("Created resources/icon.svg")
    
    # Convert SVG to 1024x1024 PNG
    subprocess.run(['convert', '-background', 'none', '-density', '300', 'resources/icon.svg', '-resize', '1024x1024', 'resources/icon.png'], check=True)
    print("Converted resources/icon.svg to 1024x1024 resources/icon.png")

if __name__ == '__main__':
    main()
