extends Node2D

@export
var borderLength : int = 30
var borders: Rect2i = Rect2i(1,1, borderLength,borderLength)
var borderPadding : int = 10

var coordReigon : Array[Vector2i] = []

var pathfinder : Pathfinder

# should be a const lol
@export var gridSize: int = 64

## returns array of nodes, but I assume all are Node2Ds
#var entities: Array[Node] = $Entities.get_children()

@onready
var tileParent : TileParent = $Tiles

@onready 
var rowScene: PackedScene = load("res://WorldGen/Column.tscn")
@onready 
var tileScene: PackedScene = load("res://Tile/Tile.tscn")
@onready
var dwarfScene: PackedScene = load("res://Dwarf/Dwarf.tscn")

func _ready():
	var traversableCoordinates : Array[Vector2i] = generateLevel()
	pathfinder = Pathfinder.new(tileParent)
	addEntities(traversableCoordinates[0])
	
func addEntities(origin : Vector2i):
	# spawn in entities
	for i in range(2):
		$Entities.add_child(dwarfScene.instantiate())
	
	# move entities into tile coordinates
	for entity in $Entities.get_children():
		assert(entity is Node2D, "Entity in world is not Node2D")
		entity.position = Vector2i(origin.x*gridSize, origin.y*gridSize)
		entity.coordinates = origin
		
	$Camera.position = $Entities/Dwarf.position
	
# Returns the traversable coordinates, the origin is the first element
func generateLevel() -> Array[Vector2i]:
	# setup grid with rock Tiles
	for i in range(borderLength+borderPadding):
		var column : Node2D = rowScene.instantiate()
		column.name = "Column "+str(i)
		tileParent.add_child(column)
		for j in range(borderLength+borderPadding):
			var tile : Tile = tileScene.instantiate()
			tile.name = "Tile "+str(j)
			column.add_child(tile)
			tile.position = Vector2i(\
			(i) * gridSize, (j) * gridSize)
			tile.coordinates = Vector2i(i, j)
			tile.boundIn.connect(_inbound)
			tile.boundOut.connect(_outbound)
			

	@warning_ignore("narrowing_conversion", "integer_division")
	var pathSpawn: RockSpawner = RockSpawner.new(Vector2i(borderLength/2, \
	borderLength/2.5), borders, "godot")
	var path: Array[Vector2i] = pathSpawn.walk(600)
	pathSpawn.queue_free()
	for location in path:
		tileParent.getTileAt(Vector2i(location.x, location.y)).setToGround()
	
	return path


func cameraFollow(entity: Dwarf):
	if $Camera.cameraTarget:
		$Camera.removeCurrentTarget()
	print("Following "+ entity.name)
	$Camera.cameraTarget = entity

func _inbound(tile : Tile) -> void:
	if coordReigon.is_empty():
		coordReigon.append(tile.coordinates)

func _outbound(tile : Tile, msg : String = "normal") -> void:
	# need exactly 2 coordinates in this array to determine reigon, break if error
	if coordReigon.size() == 1:
		coordReigon.append(tile.coordinates)
	else:
		print("error with selection")
		coordReigon.clear()
		return
	
	var reigonStart := Vector2i(
		coordReigon[0].x if coordReigon[0].x < coordReigon[1].x else coordReigon[1].x,\
		coordReigon[0].y if coordReigon[0].y < coordReigon[1].y else coordReigon[1].y \
	)
	
	var reigonStop := Vector2i(
		coordReigon[0].x if coordReigon[0].x > coordReigon[1].x else coordReigon[1].x,\
		coordReigon[0].y if coordReigon[0].y > coordReigon[1].y else coordReigon[1].y \
	)
	coordReigon[0] = reigonStart
	coordReigon[1] = reigonStop
	print(str(coordReigon)+"\n")
	
	var justOneTile : Array[Tile] = [tile]
	var tilesInReigon : Array[Tile] = getTilesInRegion(coordReigon) \
		if coordReigon[0] != coordReigon[1] else justOneTile
	
	# right now sending all dwarves to clicked location
	for entity in $Entities.get_children():
		assert(entity is Node2D, "Entity in world is not Node2D")
		
		# interrupt entity mid command then add new command
		if msg == "force":
			entity.commandQueue.clear()
		
		# move command by default
		if HUD.moveModeActive:
			var travesrableTiles : Array[Tile] = []
			for potentialTile in tilesInReigon:
				var potentialPath = pathfinder.findPathTo(potentialTile.coordinates, entity.coordinates)
				if not potentialPath.is_empty():
					travesrableTiles.append(potentialTile)
				
			# BUG where dwarf would only move 2 tiles not giving path
			if not travesrableTiles.is_empty():
				var choosenTile = travesrableTiles.pick_random()
				entity.commandQueue.order(Dwarf.Move.new(choosenTile.coordinates))
			else:
				print("No possible tile to move to")
				
		elif HUD.miningModeActive:
			# currently working on one tile being ordered to mine
			var pathToTile : Array[Vector2i] = pathfinder.findClosestNeighborPath(tile.coordinates, entity.coordinates)
			if pathToTile.is_empty():
				print("Can't find tile to move to to mine that")
			else:
				var coordsToMoveTo = pathToTile[-1]
				entity.commandQueue.order(Dwarf.Move.new(coordsToMoveTo))
				entity.commandQueue.order(Dwarf.Mine.new([tile.coordinates]))
			
	coordReigon.clear()

# might return arrays for traversable and untraversable in this function
func getTilesInRegion(region : Array[Vector2i]) -> Array[Tile]:
	var availableTiles : Array[Tile] = []

	var dx : int = region[1].x - region[0].x
	var dy : int = region[1].y - region[0].y
	for xIndex in range(dx):
		for yIndex in range(dy):
			availableTiles.append(
				tileParent.getTileAt(Vector2i(region[0].x + xIndex, region[0].y + yIndex))
			)
	return availableTiles
