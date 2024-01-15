extends Node2D

# in pixels
const TILE_SIZE := Vector2i(64, 64)
# in tiles
const CHUNK_SIZE := Vector2i(32, 32)

@export
var startingDwarves : int = 1

var creatureSpawn : Vector2i

var selectedCords : Array[Vector2i] = []

var sitesToMine : SitesToMine

var pathfinder : Pathfinder

var rockOrNah = FastNoiseLite.new()

@onready
var chunkParent : Node = $Chunks
var loadedChunks: Dictionary = {}

@onready 
var tileScene: PackedScene = load("res://Game/Tile/Tile.tscn")
@onready
var dwarfScene: PackedScene = load("res://Game/Dwarf/Dwarf.tscn")

func _ready():
	# define noise
	var hashedSeed := hash(HUD.SEED)
	rockOrNah.seed = hashedSeed
	rockOrNah.frequency = 0.07

	spawnChunks()


func _addEntities(spawnLoc : Vector2i):
	creatureSpawn = spawnLoc
	# spawn in entities
	for i in range(startingDwarves):
		addDwarf(creatureSpawn)
	
## Generates a chunk starting from the given vector
func generateChunk(northWestCorner: Vector2i):
	var chunk : Node2D = Node2D.new()
	chunk.name = "chunk X: %s Y: %s" % [northWestCorner.x, northWestCorner.y]
	chunkParent.add_child(chunk)
	loadedChunks[northWestCorner] = chunk
	for i in range(CHUNK_SIZE.x):
		var column : Node2D = Node2D.new()
		chunk.call_deferred("add_child", column)
		for j in range(CHUNK_SIZE.y):
			var xCord: int = i + northWestCorner.x
			var yCord: int = j + northWestCorner.y
			var noiseValue = rockOrNah.get_noise_2d(xCord, yCord) 
			var tile : Tile = tileScene.instantiate()
			tile.position = Vector2(xCord, yCord) * Vector2(TILE_SIZE)
			tile.coordinates = Vector2i(xCord, yCord)
			tile.boundIn.connect(_inbound)
			tile.boundOut.connect(_outbound)
			column.call_deferred("add_child", tile)
			if noiseValue < 0.0:
				tile.traversable = true

## Spawn the starting chunks around the origin
func spawnChunks() -> void:
	var origin := Vector2i(0, 0)
	generateChunk(origin - CHUNK_SIZE)
	generateChunk(Vector2i(origin.x, origin.y - CHUNK_SIZE.y))
	generateChunk(Vector2i(origin.x - CHUNK_SIZE.x, origin.y))
	generateChunk(origin)

func _inbound(tile : Tile) -> void:
	if selectedCords.is_empty():
		selectedCords.append(tile.coordinates)

func _outbound(tile : Tile, msg : String = "normal") -> void:
	# need exactly 2 coordinates in this array to determine reigon, break if error
	if selectedCords.size() == 1:
		selectedCords.append(tile.coordinates)
	else:
		print("error with selection")
		selectedCords.clear()
		return
	
	var reigonStart := Vector2i(
		selectedCords[0].x if selectedCords[0].x < selectedCords[1].x else selectedCords[1].x,
		selectedCords[0].y if selectedCords[0].y < selectedCords[1].y else selectedCords[1].y
	)
	
	var reigonStop := Vector2i(
		selectedCords[0].x if selectedCords[0].x > selectedCords[1].x else selectedCords[1].x,
		selectedCords[0].y if selectedCords[0].y > selectedCords[1].y else selectedCords[1].y
	)
	selectedCords[0] = reigonStart
	selectedCords[1] = reigonStop
	print("%s\n" % str(selectedCords))
	
	var tilesInReigon : Array[Tile] = getTilesInRegion(selectedCords) 
	
	if HUD.moveModeActive:
		# right now sending all dwarves to clicked location
		for entity in $Entities.get_children():
			assert(entity is Node2D, "Entity in world is not Node2D")
			# interrupt entity mid command then add new command
			if msg == "force":
				entity.commandQueue.clear()
				
			if tile.traversable:
				entity.commandQueue.order(Command.Move.new(tile.coordinates))
			else:
				print("Can't move there")
			
	elif HUD.miningModeActive:
		# logic handled in SitesToMine class
		for potentialTile in tilesInReigon:
			if not potentialTile.traversable:
				if msg == "force":
					sitesToMine.removeSite(potentialTile)
				elif msg != "force":
					sitesToMine.addSite(potentialTile)

	selectedCords.clear()

# YES let's do that! get TilesInReigon for starting chunk at first after world gen
# might return arrays for traversable and untraversable in this function
func getTilesInRegion(region : Array[Vector2i]) -> Array[Tile]:
	var availableTiles : Array[Tile] = []

	var xdist : int = region[1].x - region[0].x + 1
	var ydist : int = region[1].y - region[0].y + 1

	for xIndex in range(xdist):
		for yIndex in range(ydist):
			availableTiles.append(
				# FIX currently broken from chunks
				chunkParent.getTileAt(Vector2i(region[0].x + xIndex, region[0].y + yIndex))
			)

	return availableTiles


func _process(_delta):
	if HUD.readyForDwarfSpawn:
		print("Dwarf Spawned")
		addDwarf(creatureSpawn)
		HUD.readyForDwarfSpawn = false

func addDwarf(coords: Vector2i):
	var dwarf : Dwarf = dwarfScene.instantiate()
	$Entities.add_child(dwarf)
	dwarf.coordinates = coords
	dwarf.position = Vector2(coords * TILE_SIZE)
