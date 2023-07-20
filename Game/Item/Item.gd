extends Node2D
class_name ItemInWorld

@onready var itemSprite : Sprite2D = self.get_child(1)
@onready var shadowSprite : Sprite2D = self.get_child(0)

var flint : Texture2D = load("res://Assets/Items/Flint.png")
var rock : Texture2D = load("res://Assets/Items/Rock.png")

var itemTextureDict: = {
	"flint": flint,
	"rock": rock,
}

var timebetween : float = 3.0

var currentItem : String
var items : Array[String] = []

func addItem(itemName : String)->void:
	items.append(itemName)
	updateItems()
	
func updateItems()->void:
	if self.visible:
		return
	
	if items.is_empty():
		self.visible = false
	else:
		self.visible = true
		while !items.is_empty():
			for itemName in items:
				itemSprite.texture = itemTextureDict[itemName]
				await get_tree().create_timer(timebetween).timeout
		
