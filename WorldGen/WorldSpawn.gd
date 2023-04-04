extends Node2D

@export
var borderLength : int = 30
var borders: Rect2i = Rect2i(1,1, borderLength,borderLength)
var borderPadding : int = 2
# should be a const lol
@export var gridSize: int = 64

# I'm going to spawn entities directly, a reference to the node itself is more useful
#@onready
## returns array of nodes, but I assume all are Node2Ds
#var entities: Array[Node] = $Entities.get_children()

@onready 
var rowScene: PackedScene = load("res://WorldGen/Column.tscn")
@onready 
var tileScene: PackedScene = load("res://Tile/Tile.tscn")

func _ready():
	generateLevel()
	
func generateLevel():
	# setup grid with rock Tiles
	for i in range(borderLength+borderPadding):
		var column : Node2D = rowScene.instantiate()
		column.name = "Column "+str(i)
		$Tiles.add_child(column)
		for j in range(borderLength+borderPadding):
			var tile : Tile = tileScene.instantiate()
			tile.name = "Tile "+str(j)
			column.add_child(tile)
			tile.position = Vector2i(\
			(i) * gridSize, (j) * gridSize)
			tile.coordinates = Vector2i(i, j)
			tile.actionGiven.connect(_action_given)
			

	var pathSpawn: RockSpawner = RockSpawner.new(Vector2i(borderLength/2, \
	borderLength/2.5), borders)
	var path: Array[Vector2i] = pathSpawn.walk(600)
	pathSpawn.queue_free()
	
	# spawn in entities
	for entity in $Entities.get_children():
		assert(entity is Node2D, "Entity in world is not Node2D")
		entity.position = Vector2i(path[0][0]*gridSize, path[0][1]*gridSize)
		entity.coordinates = Vector2i(path[0][0], path[0][1])
		
	$Camera.position = $Entities/Dwarf.position
	for location in path:
		$Tiles.get_children()[location.x].get_children()[location.y].setToGround()

func _action_given(tile : Tile, coordinates : Vector2i) -> void:
	# right now sending all dwarves to clicked location
	for entity in $Entities.get_children():
		assert(entity is Node2D, "Entity in world is not Node2D")
		
		if tile.traversable:
			entity.commandQueue.order(Dwarf.Command.new(coordinates))
		else:
			print(entity.name+" Cannot move to location")
