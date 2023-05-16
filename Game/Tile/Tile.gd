extends Node2D
class_name Tile

signal boundIn
signal boundOut

@onready var sprite : Sprite2D = $Sprite2D
var rockImg : Texture2D = load("res://Assets/Rock.png")
var groundImg : Texture2D = load("res://Assets/Ground.png")

var coordinates : Vector2i = Vector2i()
var tooltipText : String = "Tile"

var mouseInPanel : bool = false
var beenEdited : bool = false

var movementCost : float = 0.5
var traversable : bool = false

var orderedToMine : bool = false
var percentMined : float = 0.0

#NOTE I don't know how much 900 process funcs drain, but here we are.
func _process(_delta) -> void:
	if(HUD.tileTooltipsEnabled):
		$Panel.tooltip_text = tooltipText
	else:
		$Panel.tooltip_text = ""
	
	# might make flashing i dunno
	if(orderedToMine and HUD.miningModeActive):
		$Mine.visible = true
	else:
		$Mine.visible = false

func _input(event : InputEvent) -> void:
	if mouseInPanel:
		if not beenEdited and Input.is_action_pressed("right-click"):
			if traversable:
				setToRock()
			else:
				setToGround()
			beenEdited = true
		
		if Input.is_action_just_released("right-click"):
			beenEdited = false
		
		if Input.is_action_just_pressed("click"):
			print("inbound "+str(coordinates))
			boundIn.emit(self)
			
		if Input.is_action_just_released("click") and event.is_action("click"):
			# when holding shift, might trigger an outBound from shift press
			# Confirm the action is a click
			print("outbound "+str(coordinates))
			# was hoping to find like a mods prop on event, but this works
			if event.as_text().begins_with("Shift"):
				boundOut.emit(self, "force")
			else:
				boundOut.emit(self)

	else:
		beenEdited = false

func _ready() -> void:
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
	print(name+" was mined a bit")
	# take in entity info, for like mining proficency
	percentMined += 0.2 # randomize in some way?
	if percentMined >= 1.0:
		removeMineable()
		setToGround()
	
func setToRock() -> void:
	sprite.texture = rockImg
	tooltipText = "Rock"
	setName(tooltipText)
	traversable = false
	
func setToGround() -> void:
	traversable = true
	sprite.texture = groundImg
	tooltipText = "Ground"
	setName(tooltipText)

func setName(text : String) -> void:
	name = text + " " + str(coordinates)

func _on_panel_mouse_entered() -> void:
	mouseInPanel = true

func _on_panel_mouse_exited() -> void:
	mouseInPanel = false
