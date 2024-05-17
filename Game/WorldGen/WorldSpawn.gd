extends Node2D

# in pixels
const TILE_SIZE := Vector2i(64, 64)
# in tiles
const CHUNK_SIZE := Vector2i(16, 16)
const CHUNK_PIXELS = Vector2(CHUNK_SIZE * TILE_SIZE)

@export var startingEntities: int = 1

var creatureSpawn: Vector2i

var selectedCords: Array[Vector2i] = []

var pathfinder: Pathfinder

var rockOrNah = FastNoiseLite.new()

@onready var chunkParent: Node = %TileManager
var loadedChunks: Dictionary = {}

@onready var playerNode: Node2D = %Camera

@onready var tileScene: PackedScene = load("res://Game/Tile/Tile.tscn")
@onready var creatureScene: PackedScene = load("res://Game/AI/Creature.tscn")

func _ready():
	# define noise
	var hashedSeed := hash(HUD.SEED)
	rockOrNah.seed = hashedSeed
	rockOrNah.frequency = 0.07

	spawnChunks()
	_addEntities(Vector2( - 1, 0))

func _process(_delta: float) -> void:
	# if playerNode:
	# 	processChunks(playerNode.position)

	if HUD.readyForDwarfSpawn:
		print("Creature Spawned")
		addCreature(creatureSpawn)
		HUD.readyForDwarfSpawn = false

func _addEntities(spawnLoc: Vector2i):
	# set spawn point for entities
	# TODO make this a walkable, large enough area
	creatureSpawn = spawnLoc
	# spawn in entities
	for i in range(startingEntities):
		addCreature(creatureSpawn)

## Generates a chunk starting from the given vector
func generateChunk(northWestCorner: Vector2i):
	var chunk: Node2D = Node2D.new()
	chunk.name = "(%s, %s)" % [northWestCorner.x, northWestCorner.y]
	chunkParent.add_child(chunk)
	loadedChunks[northWestCorner] = chunk
	for i in range(CHUNK_SIZE.x):
		for j in range(CHUNK_SIZE.y):
			var xCord: int = i + northWestCorner.x
			var yCord: int = j + northWestCorner.y
			var noiseValue = rockOrNah.get_noise_2d(xCord, yCord)
			var tile: Tile = tileScene.instantiate()
			tile.name = "(%s, %s)" % [xCord, yCord]
			tile.position = Vector2(xCord, yCord) * Vector2(TILE_SIZE)
			tile.coordinates = Vector2i(xCord, yCord)
			tile.tileManager = %TileManager
			chunk.call_deferred("add_child", tile)
			if noiseValue < 0.0:
				tile.traversable = true

## Spawn the starting chunks around the origin
func spawnChunks() -> void:
	var origin := Vector2i(0, 0)
	generateChunk(origin - CHUNK_SIZE)
	generateChunk(Vector2i(origin.x, origin.y - CHUNK_SIZE.y))
	generateChunk(Vector2i(origin.x - CHUNK_SIZE.x, origin.y))
	generateChunk(origin)

## Load chunks around given positon, unload away from position
func processChunks(pos: Vector2) -> void:
	# take the literal world position and identify which chunk it's in, a chunk's coordinates are it's top left tile
	var currentChunkCords: Vector2i = (
		Vector2i(pos - (CHUNK_PIXELS / 2)).snapped(CHUNK_PIXELS) / TILE_SIZE
	)

	# unload chunks far away first
	for chunkCord in loadedChunks.keys():
		var chunkDist: Vector2i = abs(currentChunkCords - chunkCord) / CHUNK_SIZE
		if chunkDist.length() > 9:
			loadedChunks[chunkCord].queue_free()
			loadedChunks.erase(chunkCord)

	# determine which chunks should be loaded at the given position
	var chunksToLoad: Array[Vector2i] = getChunksToLoad(currentChunkCords)
	for chunkCord in chunksToLoad:
		if !loadedChunks.has(chunkCord):
			generateChunk(chunkCord)

func getChunksToLoad(centerChunk: Vector2i) -> Array[Vector2i]:
	var squareRadius := 2
	var chunksToLoad: Array[Vector2i] = []
	for x in range( - 1 * squareRadius, squareRadius + 1):
		for y in range( - 1 * squareRadius, squareRadius + 1):
			chunksToLoad.append(centerChunk + Vector2i(CHUNK_SIZE.x * x, CHUNK_SIZE.y * y))

	return chunksToLoad

# These two functions are unused now, but could be used when selected with keyboard instead of mouse.
func _inbound(tile: Tile) -> void:
	if selectedCords.is_empty():
		selectedCords.append(tile.coordinates)

func _outbound(tile: Tile, _msg: String="normal") -> void:
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

	var tilesInReigon: Array[Tile] = getTilesInRegion(selectedCords)
	print(tilesInReigon)

	selectedCords.clear()

# the function below is only used in _outbound above
# FIX currently broken from chunks
func getTilesInRegion(region: Array[Vector2i]) -> Array[Tile]:
	var availableTiles: Array[Tile] = []

	var xdist: int = region[1].x - region[0].x + 1
	var ydist: int = region[1].y - region[0].y + 1

	for xIndex in range(xdist):
		for yIndex in range(ydist):
			availableTiles.append(
					chunkParent.getTileAt(Vector2i(region[0].x + xIndex, region[0].y + yIndex))
			)

	return availableTiles

## Spawn a creature at given tile coordinate
func addCreature(coords: Vector2i):
	var creature: Creature = creatureScene.instantiate()
	creature.tileManager = %TileManager
	creature.tileCoordinates = coords
	creature.position = Vector2(coords * TILE_SIZE)
	%Creatures.add_child(creature)
