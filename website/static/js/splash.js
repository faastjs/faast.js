let leftBoxContainer, rightBoxContainer;

function animate(hero) {
    const { offsetHeight, offsetWidth, children } = hero;

    let contentWidth = 0;
    for (let child of children) {
        contentWidth = Math.max(child.offsetWidth, contentWidth);
    }
    const boxSize = 35;
    const minBoxPadding = 10;
    const colWidth = (offsetWidth - contentWidth) / 2;
    const cols = Math.min(10, Math.floor(colWidth / (boxSize + minBoxPadding) - 1));
    const rows = Math.min(10, Math.floor(offsetHeight / (boxSize + minBoxPadding) - 1));
    const verticalBoxPadding = (offsetHeight - rows * boxSize) / rows;
    const horizontalBoxPadding = (colWidth - cols * boxSize) / cols;
    const top =
        (offsetHeight - rows * (boxSize + verticalBoxPadding) + verticalBoxPadding) / 2;
    const left =
        (colWidth - cols * (boxSize + horizontalBoxPadding) + horizontalBoxPadding) / 2;

    function makeBoxes(side) {
        const boxes = [];
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const d = document.createElement("div");
                d.className = "box";
                const style = d.style;
                style.top = (boxSize + verticalBoxPadding) * row + top + "px";
                style[side] = (boxSize + horizontalBoxPadding) * col + left + "px";
                boxes.push(d);
            }
        }
        return boxes;
    }

    const rowDelay = 50;
    const maxBorderTimeout = 3000;
    const collapseDelay = 1500;
    const collapseSpeed = 500;

    function expandBoxes(boxes) {
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const box = boxes[col * rows + row];
                const style = box.style;
                style.transitionDelay = (rowDelay / 1000) * (rows - row) + "s";
                style.backgroundColor = "rgba(255,255,255,.15)";
                setTimeout(() => {
                    style.border = `2px solid ${randomColor()}`;
                }, Math.random() * maxBorderTimeout + rowDelay * rows);
            }
        }
        setTimeout(() => {
            collapseBoxes(boxes);
        }, maxBorderTimeout + rowDelay * rows + collapseDelay);
    }

    function collapseBoxes(boxes) {
        boxes.forEach(box => {
            const style = box.style;
            const delay = (Math.random() * collapseSpeed) / 1000;
            style.backgroundColor = "rgba(255,255,255,.15)";
            style.transitionDelay = delay + "s";
        });
    }

    function randomColor() {
        const n = Math.random();
        if (n < 0.1) {
            return "var(--brand-color)";
        }
        if (n < 0.3) {
            return "#ECECEC";
        }
        return "rgba(255,255,255,.15)";
    }

    const leftBoxes = makeBoxes("left");
    const rightBoxes = makeBoxes("right");
    leftBoxContainer = document.createElement("div");
    rightBoxContainer = document.createElement("div");
    leftBoxContainer.append(...leftBoxes);
    rightBoxContainer.append(...rightBoxes);
    hero.append(leftBoxContainer);
    hero.append(rightBoxContainer);

    function transition() {
        expandBoxes(leftBoxes, "left");
        expandBoxes(rightBoxes, "right");
    }
    collapseBoxes(leftBoxes);
    collapseBoxes(rightBoxes);
    setTimeout(transition, 500);
    setInterval(transition, 15000);
}

window.addEventListener("load", () => {
    const hero = document.querySelector(".heroWrapper");
    if (!hero) {
        return;
    }
    animate(hero);

    const delay = 200;
    resizeTaskId = null;
    window.addEventListener("resize", evt => {
        if (resizeTaskId !== null) {
            clearTimeout(resizeTaskId);
        }

        resizeTaskId = setTimeout(() => {
            resizeTaskId = null;
            leftBoxContainer && leftBoxContainer.remove();
            rightBoxContainer && rightBoxContainer.remove();
            animate(hero);
        }, delay);
    });
});
