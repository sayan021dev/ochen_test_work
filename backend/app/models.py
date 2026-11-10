from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ElementId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Color = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
Finite = Annotated[float, Field(allow_inf_nan=False)]
Family = Literal[
    "book", "phone", "puzzle", "coin", "headphones", "lamp", "flowers", "wallet", "folder", "pen"
]
Format = Literal[
    "square", "landscape", "portrait", "standard", "hd", "fullhd", "post", "story", "wide"
]
FORMATS = {
    "square": (1000, 1000),
    "landscape": (1200, 630),
    "portrait": (800, 1200),
    "standard": (800, 600),
    "hd": (1280, 720),
    "fullhd": (1920, 1080),
    "post": (1080, 1080),
    "story": (1080, 1920),
    "wide": (1600, 900),
}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Palette(Model):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[\w-]+$")
    name: str = Field(min_length=1, max_length=60)
    background: list[Color] = Field(min_length=4, max_length=4)
    object: list[Color] = Field(min_length=4, max_length=4)


class Shadow(Model):
    angle: Finite = Field(default=90, ge=0, le=360)
    length: Finite = Field(default=1, ge=0, le=2)
    opacity: Finite = Field(default=1, ge=0, le=1)
    x: Finite = Field(default=0, ge=-5000, le=5000)
    y: Finite = Field(default=0, ge=-5000, le=5000)
    scale_x: Finite = Field(default=1, ge=0.05, le=6)
    scale_y: Finite = Field(default=1, ge=0.05, le=6)


class Element(Model):
    id: ElementId
    family: Family
    role: Literal["main", "background"] = "main"
    x: Finite = Field(ge=-5000, le=5000)
    y: Finite = Field(ge=-5000, le=5000)
    angle: Finite = Field(default=0.0, ge=-360, le=360)
    scale_x: Finite = Field(default=1, ge=0.05, le=6)
    scale_y: Finite = Field(default=1, ge=0.05, le=6)
    hidden: bool = False
    locked: bool = False
    shadow: Shadow | None = None
    support_ids: list[ElementId] = Field(default_factory=list, max_length=6)


def support_order(elements: list[Element]) -> list[Element]:
    """Validate the instance graph and return its stable support-before-caster order.

    The first ready element in the original array wins. Input lists and instances
    remain untouched; hidden supports participate in validation and ordering too.
    """
    identifiers = {element.id for element in elements}
    if len(identifiers) != len(elements):
        raise ValueError("ID экземпляров должны быть уникальными")
    for element in elements:
        if len(element.support_ids) != len(set(element.support_ids)):
            raise ValueError("Опоры предмета должны быть уникальными")
        if element.id in element.support_ids:
            raise ValueError("Предмет не может быть собственной опорой")
        if not set(element.support_ids) <= identifiers:
            raise ValueError("Опора должна ссылаться на существующий предмет сцены")
    pending = list(elements)
    emitted = set()
    ordered = []
    while pending:
        ready = next(
            (i for i, element in enumerate(pending) if set(element.support_ids) <= emitted), None
        )
        if ready is None:
            raise ValueError("Связи опор не должны образовывать цикл")
        element = pending.pop(ready)
        ordered.append(element)
        emitted.add(element.id)
    return ordered


class SceneLight(Model):
    enabled: bool = False
    x: Finite = Field(ge=-5000, le=5000)
    y: Finite = Field(ge=-5000, le=5000)
    height: Finite = Field(default=1000, ge=50, le=5000)
    opacity: Finite = Field(default=0.35, ge=0, le=1)


class Scene(Model):
    version: Literal[1] = 1
    title: str = Field(default="Новая композиция", min_length=1, max_length=120)
    format: Format = "landscape"
    detail: Literal["L", "S"] = "L"
    scale: Finite = Field(default=0.4, ge=0.03, le=8)
    palette: Palette
    transparent: bool = False
    light: SceneLight | None = None
    elements: list[Element] = Field(default_factory=list, max_length=48)

    @model_validator(mode="after")
    def unique_ids(self):
        if self.detail == "L" and self.scale > 4:
            raise ValueError("Для детализации L максимальный общий масштаб равен 4")
        ordered = support_order(self.elements)
        # Pydantic validates assignment; assigning here would recurse into this
        # same after-validator. Every member was already validated by the field.
        object.__setattr__(self, "elements", ordered)
        return self

    @property
    def size(self) -> tuple[int, int]:
        return FORMATS[self.format]


class ComposeRequest(Model):
    prompt: str = Field(min_length=1, max_length=1000)
    mode: Literal["components", "metaphor"] = "metaphor"
    format: Format = "landscape"
    detail: Literal["L", "S"] = "L"
    palette: Palette
    seed: int = Field(default=0, ge=0, le=1000000)
    backgrounds: bool = True
    use_ai: bool = True
    light: SceneLight | None = None

    @model_validator(mode="after")
    def nonempty_prompt(self):
        if not self.prompt.strip():
            raise ValueError("Опишите идею или назовите предметы")
        return self


class ProjectWrite(Model):
    scene: Scene
    revision: int = Field(default=0, ge=0)
