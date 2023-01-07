extends Node2D

@export
var borders = Rect2(1,1, 38,21)

# should be a const lol
@export var gridSize = 64

@onready var rockScene = load("res://Rock.tscn")

func _ready():
	generateLevel()
	
func generateLevel():
	var rocks = RockSpawner.new(Vector2i(19,11), borders)
	var map = rocks.walk(500)
	rocks.queue_free()
	for location in map:
		var currentRock : StaticBody2D = rockScene.instantiate()
		self.add_child(currentRock)
		currentRock.position = Vector2i(location[0] * gridSize, location[1] * gridSize)

