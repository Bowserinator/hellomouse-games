from os import listdir
from os.path import isfile, join

INPUT_DIR = "elements_raw"
DIVIDER = "+SPECIAL_DIVIDER+"
DIVIDER2 = "-SPECIAL_DIVIDER-"

elements = [f for f in listdir(INPUT_DIR) if isfile(join(INPUT_DIR, f))]

for element in elements:
	p = join(INPUT_DIR, element)
	with open(p, "r") as f:
		code = f.read()
		if "static int update(UPDATE_FUNC_ARGS)" in code or "static int graphics(GRAPHICS_FUNC_ARGS)" in code:
			print(element + "\n" + DIVIDER)
			print(code.split("}", 1)[1].strip())
			print(DIVIDER2)