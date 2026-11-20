# Defining models

## 1. Model in Blockbench

- Create a **Free Model** (generic) project. Use only cubes; one cube per colour block.
- Work at 16 px = 1 m. Origin `(0, 0, 0)` is the ground point at the centre of the unit.
- Up is `+Y`. The model faces `+X`; use the `yaw` field in the registry if it was built facing another way.
- Give cubes a flat palette colour, or share a single texture across the whole model. Two textures are rejected.

## 2. Group and name the parts

- Put every fixed cube under a root group named `body`.
- Make each moving part its own group, nested under `body` (or under another moving part). Set the group **pivot** at the point the part rotates around. The group name decides the behaviour:
    - `turret` or `turret_N` (N = 0-3): rotates around the Y axis to aim. Pivot on the vertical axis of the swivel. `N` matches the weapon slot on the entity; plain `turret` is slot 0.
    - `barrel_N` (N = 0-3): slides backwards along X when the weapon fires. Nest it inside its turret.
    - `spin_x_NAME`, `spin_y_NAME`, `spin_z_NAME`: spins constantly around that axis through the pivot (rotors, fans, tail rotors). `spin_x_gatling` only spins while the unit is firing.
    - `roll_NAME`: wheel or track roller that turns around Z as the unit travels. Pivot at the axle.
    - `walk_l` / `walk_r`: legs that swing around Z in opposite phase while moving. Pivot at the hip.
- Groups with any other name are treated as part of their parent.
- Add a tiny 1 px cube named `muzzle_N` (N = 0-3) at the barrel tip, inside the same group as its barrel. It is never drawn; shots and muzzle flashes start from its position. Without it they start from the unit centre.

## 3. Export

- Save the project to `models-src/<name>.bbmodel`.
- Export as glTF in the binary `.glb` format to `models/<name>.glb`.

## 4. Register

- Add an entry to `MODELS` in `js/render/model-registry.ts`. The key must match the entity name exactly (e.g. `'Heli gunship'`).
- `url`: the `.glb` file name.
- `scale`: `1 / 16` for models built at 16 px per metre.
- `yaw`: extra rotation in radians if the model does not face `+X`.
- `height`, `halfWidth`, `halfDepth`: size in metres, used for click selection and health bars.
- `spin` (optional): rotation speed in rad/s per `spin_*` part name, e.g. `{ rotor: 40 }`. The default is 25.

## 5. Check

- Open `/datacenter_defense/model-preview.html`, pick the model and adjust yaw and aim.
- Tick **Fire** to test recoil, spinning parts and muzzle position.
- Units without a registered model are drawn as plain boxes.
