extends Node2D
class_name Tile

@onready var sprite : Sprite2D = $Sprite
var rockImg : Texture2D = load("res://Assets/Tiles/Rock.png")
var groundImg : Texture2D = load("res://Assets/Tiles/Ground.png")

var coordinates : Vector2i = Vector2i()
var tooltipText : String = name

var mouseInPanel : bool = false
var beenEdited : bool = false

var movementCost : float = 0.5
var traversable : bool = false

var orderedToMine : bool = false
var percentMined : float = 0.0

func _ready() -> void:
	if traversable:
		setToGround()
	else:
		setToRock()

func labelMineable() -> void:
	if traversable:
		print("I can't be mined!!")
		return
	
	orderedToMine = true

func removeMineable() -> void:
	if orderedToMine:
		orderedToMine = false

func mine() -> void:
	print("%s was mined a bit" % name)
	# take in entity info, for like mining proficency
	percentMined += 0.2 # randomize in some way?
	if percentMined >= 1.0 and not traversable:
		removeMineable()
		setToGround()
		# dropItemChance()
	
func setToRock() -> void:
	sprite.texture = rockImg
	tooltipText = "Rock"
	traversable = false
	
func setToGround() -> void:
	traversable = true
	sprite.texture = groundImg
	tooltipText = "Ground"
	
# func dropItemChance() -> void:
# 	# make this dependant on seed in future
# 	if randf() > 0.3:
# 		items.addItem("rock")
# 	if randf() > 0.5:
# 		items.addItem("flint")