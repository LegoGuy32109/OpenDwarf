extends Node2D

@export
var borders = Rect2(1,1, 30,30)

# should be a const lol
@export var gridSize = 64

@onready var rockScene = load("res://Rock.tscn")
@onready var groundScene = load("res://Ground.tscn")

func _ready():
	generateLevel()
	
func generateLevel():
	var rocks = RockSpawner.new(Vector2i(19,11), borders)
	var map = rocks.walk(600)
	rocks.queue_free()
	$Dwarf.position = Vector2i(map[0][0]*gridSize, map[0][1]*gridSize)
	$Camera.position = $Dwarf.position
	for location in map:
		var groundTile : Node2D = groundScene.instantiate()
		$Tiles.add_child(groundTile)
		groundTile.position = Vector2i(location[0] * gridSize, location[1] * gridSize)

