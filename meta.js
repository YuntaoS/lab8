import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import scrollama from "https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm";

let allLines = [];
let allCommits = [];
let filteredCommits = [];

let commitProgress = 100;

let xScale, yScale, rScale, timeScale;
let svg;
let gMain; // 装坐标轴、点、网格的 <g>

const width = 700;
const height = 380;
const margin = { top: 20, right: 20, bottom: 40, left: 50 };
const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

// 颜色：按 type（语言 / 技术）上色
const techColor = d3.scaleOrdinal(d3.schemeTableau10);

// Step 0:loc.csv
async function loadData() {
  const data = await d3.csv("loc.csv", (row) => ({
    ...row,
    line: +row.line,
    depth: +row.depth,
    length: +row.length,
    date: new Date(row.date + "T00:00" + row.timezone),
    datetime: new Date(row.datetime),
  }));
  return data;
}

// Step 1: commit 汇总
function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      const first = lines[0];
      const { author, date, time, timezone, datetime } = first;

      const ret = {
        id: commit,
        url:
          "https://github.com/YuntaoS/cogs106_lab1_-portfolio/commit/" +
          commit,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      Object.defineProperty(ret, "lines", {
        value: lines,
        enumerable: false, // console.log 时不显示，但可以访问
      });

      return ret;
    });
}

function renderCommitInfo(lines, commits) {
  const container = d3.select("#stats");
  container.selectAll("*").remove();

  const dl = container.append("dl").attr("class", "stats");

  // commits 总数
  dl.append("dt").text("COMMITS");
  dl.append("dd").text(commits.length);

  // 文件数
  const fileCount = lines.length
    ? d3.group(lines, (d) => d.file).size
    : 0;
  dl.append("dt").text("FILES");
  dl.append("dd").text(fileCount);

  // 总行数
  dl.append("dt").text("TOTAL_LOC");
  dl.append("dd").text(lines.length);

  // 最大缩进 depth
  const maxDepth = lines.length ? d3.max(lines, (d) => d.depth) : 0;
  dl.append("dt").text("MAX_DEPTH");
  dl.append("dd").text(maxDepth ?? 0);

  // 最长一行长度
  const longestLine = lines.length ? d3.max(lines, (d) => d.length) : 0;
  dl.append("dt").text("LONGEST_LINE");
  dl.append("dd").text(longestLine ?? 0);

  // 单次 commit 修改最多的行数
  const maxLines =
    commits.length > 0 ? d3.max(commits, (d) => d.totalLines) : 0;
  dl.append("dt").text("MAX_LINES");
  dl.append("dd").text(maxLines ?? 0);
}

// Step 1 + Step 3: Scatterplot 
function initChart(commits) {
  // 纵轴：0 ~ 24 小时
  yScale = d3.scaleLinear().domain([0, 24]).range([innerHeight, 0]);

  // r 先给个默认 domain，后面 update 再根据数据更新
  const rExtent = d3.extent(commits, (d) => d.totalLines);
  rScale = d3
    .scaleSqrt()
    .domain(rExtent)
    .range([3, 18]);

  svg = d3
    .select("#chart")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMinYMin meet");

  gMain = svg
    .append("g")
    .attr("class", "main")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // 先加空轴 + grid + dots group
  gMain
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${innerHeight})`);

  gMain.append("g").attr("class", "y-axis");

  gMain.append("g").attr("class", "gridlines");

  gMain.append("g").attr("class", "dots");

  updateScatterPlot(commits);
}

function updateScatterPlot(commits) {
  if (!svg || commits.length === 0) {
    // 没数据时简单清空
    if (gMain) {
      gMain.select(".dots").selectAll("circle").remove();
    }
    return;
  }

  // x 轴 domain 只看当前过滤后的 commit
  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime))
    .range([0, innerWidth])
    .nice();

  const rExtent = d3.extent(commits, (d) => d.totalLines);
  rScale.domain(rExtent);

  // 轴
  gMain
    .select(".x-axis")
    .call(d3.axisBottom(xScale).ticks(6));

  gMain
    .select(".y-axis")
    .call(
      d3
        .axisLeft(yScale)
        .ticks(8)
        .tickFormat((d) => String(d).padStart(2, "0") + ":00"),
    );

  // 水平 gridlines
  gMain
    .select(".gridlines")
    .call(
      d3
        .axisLeft(yScale)
        .ticks(8)
        .tickSize(-innerWidth)
        .tickFormat(""),
    );

  const sorted = d3.sort(commits, (d) => -d.totalLines);

  const dots = gMain
    .select(".dots")
    .selectAll("circle")
    .data(sorted, (d) => d.id);

  dots.exit().remove();

  dots
    .join((enter) =>
      enter
        .append("circle")
        .attr("cx", (d) => xScale(d.datetime))
        .attr("cy", (d) => yScale(d.hourFrac))
        .attr("r", (d) => rScale(d.totalLines)),
    )
    .attr("cx", (d) => xScale(d.datetime))
    .attr("cy", (d) => yScale(d.hourFrac))
    .attr("r", (d) => rScale(d.totalLines));
}


// Step 2:  unit visualization
function updateFileDisplay(commitsForFiles) {
  const lines = commitsForFiles.flatMap((d) => d.lines);
  const container = d3.select("#files");

  // 没有任何 commit 时清空
  if (lines.length === 0) {
    container.selectAll("*").remove();
    return;
  }

  // 每个文件的行，按行数从大到小排序
  const files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => ({
      name,
      lines,
      type: lines[0]?.type ?? "other",
    }))
    .sort((a, b) => b.lines.length - a.lines.length);

  const rows = container
    .selectAll("div.file-row")
    .data(files, (d) => d.name)
    .join((enter) => {
      const row = enter.append("div").attr("class", "file-row");

      const dt = row.append("dt");
      dt.append("code");
      dt.append("small");

      row.append("dd");

      return row;
    });

  // 设置每个文件的颜色
  rows.style("--color", (d) => techColor(d.type));

  rows
    .select("dt code")
    .text((d) => d.name);

  rows
    .select("dt small")
    .text((d) => `${d.lines.length} lines`);

  // 每一行代码一个小圆点
  rows
    .select("dd")
    .selectAll("div.loc")
    .data((d) => d.lines)
    .join("div")
    .attr("class", "loc");
}


function renderScatterStory(commits) {
  d3.select("#scatter-story")
    .selectAll(".step")
    .data(commits)
    .join("div")
    .attr("class", "step")
    .html((d, i) => {
      const dateStr = d.datetime.toLocaleString("en", {
        dateStyle: "full",
        timeStyle: "short",
      });

      const commitText =
        i > 0
          ? "another glorious commit"
          : "my first commit, and it was glorious";

      const fileCount = d3.rollups(
        d.lines,
        (D) => D.length,
        (line) => line.file,
      ).length;

      return `
        <p>
          On <strong>${dateStr}</strong>,
          I made
          <a href="${d.url}" target="_blank">${commitText}</a>.
        </p>
        <p>
          I edited <strong>${d.totalLines}</strong> lines
          across <strong>${fileCount}</strong> files.
          Then I looked over all I had made, and I saw that it was very good.
        </p>
      `;
    });
}



// 给定一个截止时间，更新 slider + stats + 图表 + 文件
function updateForCutoff(cutoff) {
  // 1. 同步 slider 位置
  const slider = document.querySelector("#commit-progress");
  commitProgress = timeScale(cutoff);
  slider.value = commitProgress;

  // 2. 更新时间文字
  const timeEl = document.querySelector("#commit-time");
  timeEl.textContent = cutoff.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  // 3. 按时间过滤 commit
  filteredCommits = allCommits.filter((d) => d.datetime <= cutoff);

  // 4. 更新 stats + chart + files
  const lines = filteredCommits.flatMap((d) => d.lines);
  renderCommitInfo(lines, filteredCommits);
  updateScatterPlot(filteredCommits);
  updateFileDisplay(filteredCommits);
}

// Slider 的事件处理，转成 cutoff 时间然后复用 updateForCutoff
function onTimeSliderChange() {
  const slider = document.querySelector("#commit-progress");
  const value = Number(slider.value);

  const cutoff = timeScale.invert(value);
  updateForCutoff(cutoff);
}


function setupScrollama() {
  const scroller = scrollama();

  function onStepEnter(response) {
    // 每个 .step 的 DOM 元素身上挂着 commit 数据
    const commit = response.element.__data__;
    if (commit && commit.datetime) {
      updateForCutoff(commit.datetime);
    }
  }

  scroller
    .setup({
      container: "#scrolly-1",
      step: "#scrolly-1 .step",
      offset: 0.6, // 过屏幕 60% 高度时触发
    })
    .onStepEnter(onStepEnter);
}


async function main() {
  allLines = await loadData();
  allCommits = processCommits(allLines);

  // 按时间排序
  allCommits.sort((a, b) => a.datetime - b.datetime);

  timeScale = d3
    .scaleTime()
    .domain(d3.extent(allCommits, (d) => d.datetime))
    .range([0, 100]);

  // 初始化 scatterplo
  initChart(allCommits);

  renderScatterStory(allCommits);

  // 绑定 slider
  const slider = document.querySelector("#commit-progress");
  slider.addEventListener("input", onTimeSliderChange);

  // 初始状态：显示最后一个 commit
  const lastTime = d3.max(allCommits, (d) => d.datetime);
  updateForCutoff(lastTime);

  setupScrollama();
}

main();
