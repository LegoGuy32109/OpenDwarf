extends Node2D

@export
var startingDwarves : int = 1

var creatureSpawn : Vector2i

var coordReigon : Array[Vector2i] = []

var sitesToMine : SitesToMine

var pathfinder : Pathfinder

# should be a const lol
@export var gridSize: int = 64

## returns array of nodes, but I assume all are Node2Ds
#var entities: Array[Node] = $Entities.get_children()

@onready
var tileParent : TileParent = $Tiles

@onready 
var tileScene: PackedScene = load("res://Game/Tile/Tile.tscn")
@onready
var dwarfScene: PackedScene = load("res://Game/Dwarf/Dwarf.tscn")

func _ready():
	# I am not saving traversable coordinates, it will be auto generated
	# right now no traversable coordinates
	# var traversableCoordinates : Array[Vector2i] = generateChunk()
	pathfinder = Pathfinder.new(tileParent)
	sitesToMine = SitesToMine.new(pathfinder)
	_addEntities(Vector2i(0, 0))


func _addEntities(spawnLoc : Vector2i):
	creatureSpawn = spawnLoc
	# spawn in entities
	for i in range(startingDwarves):
		addDwarf(creatureSpawn)
	
	$Camera.position = Vector2(spawnLoc)
	
func generateChunk() -> Array[Vector2i]:
	# given matrix of a chunk, navigate it adding tiles where they need to be.
	for i in range(actualWorldLength):
		var column : Node2D = Node2D.new()
		for j in range(actualWorldLength):
			var tile : Tile = tileScene.instantiate()
			tile.position = Vector2i(\
			(i) * gridSize, (j) * gridSize)
			tile.coordinates = Vector2i(i, j)
			tile.boundIn.connect(_inbound)
			tile.boundOut.connect(_outbound)
			column.add_child(tile)
		tileParent.add_child(column)


	for location in path:
		var possibleTile : Tile = tileParent.getTileAt(Vector2i(\
		location.x, location.y))
		if possibleTile:
			possibleTile.setToGround()

	
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
		coordReigon[0].x if coordReigon[0].x < coordReigon[1].x else coordReigon[1].x,
		coordReigon[0].y if coordReigon[0].y < coordReigon[1].y else coordReigon[1].y
	)
	
	var reigonStop := Vector2i(
		coordReigon[0].x if coordReigon[0].x > coordReigon[1].x else coordReigon[1].x,
		coordReigon[0].y if coordReigon[0].y > coordReigon[1].y else coordReigon[1].y
	)
	coordReigon[0] = reigonStart
	coordReigon[1] = reigonStop
	print("%s\n" % str(coordReigon))
	
	var tilesInReigon : Array[Tile] = getTilesInRegion(coordReigon) 
	
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

	coordReigon.clear()



# YES let's do that! get TilesInReigon for starting chunk at first after world gen
# might return arrays for traversable and untraversable in this function
func getTilesInRegion(region : Array[Vector2i]) -> Array[Tile]:
	var availableTiles : Array[Tile] = []

	var xdist : int = region[1].x - region[0].x + 1
	var ydist : int = region[1].y - region[0].y + 1

	for xIndex in range(xdist):
		for yIndex in range(ydist):
			availableTiles.append(
				tileParent.getTileAt(Vector2i(region[0].x + xIndex, region[0].y + yIndex))
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
	dwarf.position = Vector2i(coords.x*gridSize, coords.y*gridSize)
