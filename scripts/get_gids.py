import requests
import re
res = requests.get('https://docs.google.com/spreadsheets/d/1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc/htmlview')
matches = re.findall(r'"gid":"(\d+)".*?"name":"(.*?)"', res.text)
print(matches)
